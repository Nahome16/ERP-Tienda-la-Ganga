using LaGanga.Application.Common;
using LaGanga.Application.Investment;
using LaGanga.Application.Settings;
using LaGanga.Domain.Catalog;
using LaGanga.Domain.Inventory;
using LaGanga.Domain.Sales;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LaGanga.Infrastructure.Inventory;

public sealed class InvestmentService(
    LaGangaDbContext dbContext,
    IAuditWriter audit) : IInvestmentService
{
    private const string NoPartnerName = "Sin socio";

    public async Task<IReadOnlyList<PartnerDto>> ListPartnersAsync(string? status, CancellationToken cancellationToken)
    {
        var partners = dbContext.Partners.AsNoTracking().AsQueryable();
        if (string.Equals(status?.Trim(), "active", StringComparison.OrdinalIgnoreCase))
        {
            partners = partners.Where(partner => partner.IsActive);
        }

        return (await partners.OrderByDescending(partner => partner.IsActive).ThenBy(partner => partner.Name).ToListAsync(cancellationToken))
            .Select(Map).ToArray();
    }

    public async Task<ServiceResult<PartnerDto>> CreatePartnerAsync(PartnerInput input, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var error = Validate(input);
        if (error is not null)
        {
            return Result.Fail<PartnerDto>(error);
        }

        var name = CatalogText.CleanVisibleName(input.Name);
        if (await dbContext.Partners.AnyAsync(partner => partner.NormalizedName == CatalogText.Normalize(name), cancellationToken))
        {
            return Result.Fail<PartnerDto>(ServiceErrorKind.Conflict, "duplicate_name", "Ya existe un socio con ese nombre.", "name");
        }

        var partner = new Partner(Guid.NewGuid(), name, input.Phone, input.Notes, actor.UserId, DateTimeOffset.UtcNow);
        dbContext.Partners.Add(partner);
        audit.Add(actor.UserId, "investment.partner_saved", "Partner", partner.Id.ToString(), $"Socio «{partner.Name}» creado.");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Result.Fail<PartnerDto>(ServiceErrorKind.Conflict, "duplicate_name", "Ya existe un socio con ese nombre.", "name");
        }

        return Result.Ok(Map(partner));
    }

    public async Task<ServiceResult<PartnerDto>> UpdatePartnerAsync(Guid id, PartnerInput input, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var partner = await dbContext.Partners.SingleOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);
        if (partner is null)
        {
            return Result.Fail<PartnerDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos ese socio.");
        }

        var error = Validate(input);
        if (error is not null)
        {
            return Result.Fail<PartnerDto>(error);
        }

        var name = CatalogText.CleanVisibleName(input.Name);
        var normalized = CatalogText.Normalize(name);
        if (await dbContext.Partners.AnyAsync(candidate => candidate.NormalizedName == normalized && candidate.Id != id, cancellationToken))
        {
            return Result.Fail<PartnerDto>(ServiceErrorKind.Conflict, "duplicate_name", "Ya existe un socio con ese nombre.", "name");
        }

        partner.Update(name, input.Phone, input.Notes, input.IsActive ?? partner.IsActive);
        audit.Add(actor.UserId, "investment.partner_saved", "Partner", partner.Id.ToString(), $"Socio «{partner.Name}» actualizado ({(partner.IsActive ? "activo" : "inactivo")}).");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Result.Fail<PartnerDto>(ServiceErrorKind.Conflict, "version_conflict", "Otra persona modificó este socio. Recargá y volvé a intentar.");
        }

        return Result.Ok(Map(partner));
    }

    public async Task<InvestmentSummaryDto> GetSummaryAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken cancellationToken)
    {
        var facts = await LoadFactsAsync(fromDate, toDate, cancellationToken);
        var rows = facts.PartnerKeys()
            .Select(key => Summarize(key, facts.PartnerName(key), facts.LotsOf(key), facts.SalesOf(key), facts.LossesOf(key)))
            .OrderByDescending(row => row.InvestedNio).ThenBy(row => row.PartnerName, StringComparer.Ordinal)
            .ToArray();
        var totals = Summarize(null, "Total", facts.Lots, facts.Sales, facts.Losses);
        return new InvestmentSummaryDto(fromDate, toDate, rows, totals with { PartnerId = null });
    }

    public async Task<IReadOnlyList<ProductBreakdownDto>> GetBreakdownAsync(
        string? partnerId,
        DateOnly? fromDate,
        DateOnly? toDate,
        CancellationToken cancellationToken)
    {
        var facts = await LoadFactsAsync(fromDate, toDate, cancellationToken);
        var onlyNone = string.Equals(partnerId?.Trim(), "none", StringComparison.OrdinalIgnoreCase);
        Guid? onlyPartner = Guid.TryParse(partnerId, out var parsed) ? parsed : null;
        var keys = facts.PartnerKeys().Where(key => (!onlyNone || key is null) && (onlyPartner is null || key == onlyPartner)).ToArray();

        var result = new List<ProductBreakdownDto>();
        foreach (var key in keys)
        {
            var lots = facts.LotsOf(key);
            var sales = facts.SalesOf(key);
            foreach (var product in lots.Select(lot => (lot.ProductId, lot.ProductName))
                         .Concat(sales.Select(sale => (sale.ProductId, sale.ProductName))).Distinct())
            {
                var productLots = lots.Where(lot => lot.ProductId == product.ProductId).ToArray();
                var productSales = sales.Where(sale => sale.ProductId == product.ProductId).ToArray();
                var summary = Summarize(key, facts.PartnerName(key), productLots, productSales, []);
                if (summary.UnitsEntered == 0 && summary.UnitsInStock == 0 && summary.UnitsSold == 0)
                {
                    continue;
                }

                result.Add(new ProductBreakdownDto(
                    key, facts.PartnerName(key), product.ProductId, product.ProductName, summary.UnitsEntered, summary.InvestedNio,
                    summary.UnitsInStock, summary.StockAtCostNio, summary.UnitsSold, summary.RevenueNio, summary.ProfitNio));
            }
        }

        return result.OrderBy(row => row.PartnerName, StringComparer.Ordinal).ThenByDescending(row => row.InvestedNio).ToArray();
    }

    public async Task<PageResult<LotDto>> ListLotsAsync(LotQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var rows =
            from lot in dbContext.StockLots.AsNoTracking()
            join variant in dbContext.Variants on lot.VariantId equals variant.Id
            join product in dbContext.Products on variant.ProductId equals product.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            join partner in dbContext.Partners on lot.PartnerId equals partner.Id into partners
            from partner in partners.DefaultIfEmpty()
            join user in dbContext.Users on lot.EnteredBy equals user.Id into users
            from user in users.DefaultIfEmpty()
            select new
            {
                lot,
                PartnerName = partner == null ? NoPartnerName : partner.Name,
                ProductId = product.Id,
                ProductName = product.Name,
                SizeName = size.Name,
                ColorName = color.Name,
                variant.Barcode,
                CurrentPrice = variant.PriceOverride ?? product.BasePrice,
                UserName = user == null ? "Sistema" : user.DisplayName,
            };

        if (query.LotId is { } lotId)
        {
            rows = rows.Where(row => row.lot.Id == lotId);
        }

        if (!string.IsNullOrWhiteSpace(query.PartnerId))
        {
            if (string.Equals(query.PartnerId.Trim(), "none", StringComparison.OrdinalIgnoreCase))
            {
                rows = rows.Where(row => row.lot.PartnerId == null);
            }
            else if (Guid.TryParse(query.PartnerId, out var partnerId))
            {
                rows = rows.Where(row => row.lot.PartnerId == partnerId);
            }
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var pattern = $"%{query.Search.Trim().Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal)}%";
            rows = rows.Where(row => EF.Functions.ILike(row.ProductName, pattern) || EF.Functions.ILike(row.Barcode, pattern));
        }

        if (query.OnlyWithStock)
        {
            rows = rows.Where(row => row.lot.QuantityRemaining > 0);
        }

        if (query.From is { } from)
        {
            var start = BusinessTime.DayRangeUtc(from).StartUtc;
            rows = rows.Where(row => row.lot.EnteredAtUtc >= start);
        }

        if (query.To is { } to)
        {
            var end = BusinessTime.DayRangeUtc(to).EndUtc;
            rows = rows.Where(row => row.lot.EnteredAtUtc < end);
        }

        var total = await rows.CountAsync(cancellationToken);
        var page = await rows.OrderByDescending(row => row.lot.EnteredAtUtc).ThenBy(row => row.ProductName).ThenBy(row => row.lot.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToListAsync(cancellationToken);
        var lotIds = page.Select(row => row.lot.Id).ToArray();
        var allocations = await (
            from allocation in dbContext.LotAllocations.AsNoTracking()
            where allocation.LotId != null && lotIds.Contains(allocation.LotId.Value)
            join sale in dbContext.Sales on allocation.SaleId equals sale.Id into sales
            from sale in sales.DefaultIfEmpty()
            where allocation.Kind == AllocationKind.Loss || (sale != null && sale.Status == SaleStatus.Confirmed)
            select new { LotId = allocation.LotId!.Value, allocation.Kind, allocation.Quantity })
            .ToListAsync(cancellationToken);

        var items = page.Select(row => ToDto(
            row.lot,
            row.PartnerName,
            row.ProductId,
            row.ProductName,
            row.SizeName,
            row.ColorName,
            row.Barcode,
            row.UserName,
            row.CurrentPrice,
            allocations.Where(a => a.LotId == row.lot.Id && a.Kind == AllocationKind.Sale).Sum(a => a.Quantity),
            allocations.Where(a => a.LotId == row.lot.Id && a.Kind == AllocationKind.Loss).Sum(a => a.Quantity))).ToArray();
        return Paging.Create(items, query.Page, query.PageSize, total);
    }

    public async Task<ServiceResult<LotDto>> UpdateLotAsync(Guid id, UpdateLotInput input, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var lot = await dbContext.StockLots.SingleOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);
        if (lot is null)
        {
            return Result.Fail<LotDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa entrada de mercadería.");
        }

        if (input.UnitCost is < 0 || input.UnitPrice is < 0)
        {
            return Result.Fail<LotDto>(ServiceErrorKind.Validation, "validation_failed", "El costo y el precio no pueden ser negativos.", "unitCost");
        }

        if (input.Note is { Length: > 500 })
        {
            return Result.Fail<LotDto>(ServiceErrorKind.Validation, "validation_failed", "La nota admite hasta 500 caracteres.", "note");
        }

        if (input.PartnerId is { } partnerId && !await dbContext.Partners.AnyAsync(partner => partner.Id == partnerId, cancellationToken))
        {
            return Result.Fail<LotDto>(ServiceErrorKind.Validation, "validation_failed", "El socio elegido no existe.", "partnerId");
        }

        var before = $"socio {lot.PartnerId?.ToString() ?? "ninguno"}, costo {lot.UnitCost?.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) ?? "—"}, precio {lot.UnitPrice?.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) ?? "—"}";
        lot.Edit(input.PartnerId, input.UnitCost, input.UnitPrice, input.Note);
        audit.Add(
            actor.UserId,
            "investment.lot_updated",
            "StockLot",
            lot.Id.ToString(),
            $"Entrada de mercadería editada. Antes: {before}. Ahora: socio {input.PartnerId?.ToString() ?? "ninguno"}, costo {input.UnitCost?.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) ?? "—"}, precio {input.UnitPrice?.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) ?? "—"}.");
        await dbContext.SaveChangesAsync(cancellationToken);

        var updated = await ListLotsAsync(new LotQuery(null, null, false, null, null, 1, 1, id), cancellationToken);
        return Result.Ok(updated.Items[0]);
    }

    private static LotDto ToDto(
        StockLot lot,
        string partnerName,
        Guid productId,
        string productName,
        string sizeName,
        string colorName,
        string barcode,
        string userName,
        decimal currentPrice,
        int sold,
        int lost) =>
        new(
            lot.Id, lot.PartnerId, partnerName, lot.VariantId, productId, productName, sizeName, colorName, barcode,
            lot.EnteredAtUtc, userName, lot.Source.ToString(), lot.Note, lot.QuantityIn, lot.QuantityRemaining, sold, lost,
            lot.UnitCost, lot.UnitPrice, currentPrice,
            lot.Source == LotSource.Restock || lot.UnitCost is null ? 0 : Math.Round(lot.QuantityIn * lot.UnitCost.Value, 2),
            lot.UnitCost is null ? 0 : Math.Round(lot.QuantityRemaining * lot.UnitCost.Value, 2));

    private static PartnerSummaryDto Summarize(
        Guid? key,
        string name,
        IReadOnlyCollection<LotFact> lots,
        IReadOnlyCollection<SaleFact> sales,
        IReadOnlyCollection<LossFact> losses)
    {
        var entered = lots.Where(lot => lot.CountsAsInvestment).ToArray();
        decimal costOf(int quantity, decimal? cost) => cost is null ? 0 : quantity * cost.Value;
        var revenue = sales.Sum(sale => sale.Revenue);
        var knownCostSales = sales.Where(sale => sale.UnitCost is not null).ToArray();
        var costOfSold = knownCostSales.Sum(sale => costOf(sale.Quantity, sale.UnitCost));
        var knownRevenue = knownCostSales.Sum(sale => sale.Revenue);
        return new PartnerSummaryDto(
            key,
            name,
            entered.Sum(lot => lot.EnteredInPeriod),
            Math.Round(entered.Sum(lot => costOf(lot.EnteredInPeriod, lot.UnitCost)), 2),
            entered.Where(lot => lot.UnitCost is null).Sum(lot => lot.EnteredInPeriod),
            lots.Sum(lot => lot.Remaining),
            Math.Round(lots.Sum(lot => costOf(lot.Remaining, lot.UnitCost)), 2),
            Math.Round(lots.Sum(lot => lot.Remaining * lot.CurrentPrice), 2),
            sales.Sum(sale => sale.Quantity),
            Math.Round(revenue, 2),
            Math.Round(costOfSold, 2),
            Math.Round(knownRevenue - costOfSold, 2),
            sales.Where(sale => sale.UnitCost is null).Sum(sale => sale.Quantity),
            losses.Sum(loss => loss.Quantity),
            Math.Round(losses.Sum(loss => costOf(loss.Quantity, loss.UnitCost)), 2));
    }

    private async Task<Facts> LoadFactsAsync(DateOnly? from, DateOnly? to, CancellationToken cancellationToken)
    {
        var start = from is { } fromDate ? BusinessTime.DayRangeUtc(fromDate).StartUtc : (DateTimeOffset?)null;
        var end = to is { } toDate ? BusinessTime.DayRangeUtc(toDate).EndUtc : (DateTimeOffset?)null;
        bool InRange(DateTimeOffset moment) => (start is null || moment >= start) && (end is null || moment < end);

        var partners = await dbContext.Partners.AsNoTracking().ToDictionaryAsync(partner => partner.Id, partner => partner.Name, cancellationToken);
        var lotRows = await (
            from lot in dbContext.StockLots.AsNoTracking()
            join variant in dbContext.Variants on lot.VariantId equals variant.Id
            join product in dbContext.Products on variant.ProductId equals product.Id
            select new
            {
                lot.Id,
                lot.PartnerId,
                lot.Source,
                lot.QuantityIn,
                lot.QuantityRemaining,
                lot.UnitCost,
                lot.EnteredAtUtc,
                ProductId = product.Id,
                ProductName = product.Name,
                CurrentPrice = variant.PriceOverride ?? product.BasePrice,
            })
            .ToListAsync(cancellationToken);
        var lots = lotRows.Select(row => new LotFact(
            row.Id, row.PartnerId, row.ProductId, row.ProductName, row.UnitCost, row.CurrentPrice, row.QuantityRemaining,
            row.Source != LotSource.Restock, InRange(row.EnteredAtUtc) ? row.QuantityIn : 0)).ToList();
        var lotById = lots.ToDictionary(lot => lot.Id);

        var saleRows = await (
            from allocation in dbContext.LotAllocations.AsNoTracking()
            where allocation.Kind == AllocationKind.Sale
            join line in dbContext.SaleLines on allocation.SaleLineId equals line.Id
            join sale in dbContext.Sales on allocation.SaleId equals sale.Id
            where sale.Status == SaleStatus.Confirmed
            join variant in dbContext.Variants on allocation.VariantId equals variant.Id
            join product in dbContext.Products on variant.ProductId equals product.Id
            select new
            {
                allocation.LotId,
                allocation.Quantity,
                line.UnitPrice,
                sale.SubtotalNio,
                sale.DiscountNio,
                sale.CreatedAtUtc,
                ProductId = product.Id,
                ProductName = product.Name,
            })
            .ToListAsync(cancellationToken);
        var sales = saleRows.Where(row => InRange(row.CreatedAtUtc)).Select(row =>
        {
            var lot = row.LotId is { } lotId ? lotById[lotId] : null;
            var ratio = row.SubtotalNio > 0 ? row.DiscountNio / row.SubtotalNio : 0m;
            return new SaleFact(lot?.PartnerId, row.ProductId, row.ProductName, row.Quantity, row.Quantity * row.UnitPrice * (1 - ratio), lot?.UnitCost);
        }).ToList();

        var lossRows = await (
            from allocation in dbContext.LotAllocations.AsNoTracking()
            where allocation.Kind == AllocationKind.Loss
            select new { allocation.LotId, allocation.Quantity, allocation.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        var losses = lossRows.Where(row => InRange(row.CreatedAtUtc)).Select(row =>
        {
            var lot = row.LotId is { } lotId ? lotById[lotId] : null;
            return new LossFact(lot?.PartnerId, row.Quantity, lot?.UnitCost);
        }).ToList();

        return new Facts(partners, lots, sales, losses);
    }

    private static PartnerDto Map(Partner partner) =>
        new(partner.Id, partner.Name, partner.Phone, partner.Notes, partner.IsActive, partner.Version);

    private static ServiceError? Validate(PartnerInput input)
    {
        var name = CatalogText.CleanVisibleName(input.Name);
        if (name.Length is 0 or > Partner.NameMaxLength)
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", $"El nombre es obligatorio (máximo {Partner.NameMaxLength} caracteres).", "name");
        }

        if (input.Phone is { Length: > 50 } || input.Notes is { Length: > 500 })
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "El teléfono admite 50 caracteres y las notas 500.", "notes");
        }

        return null;
    }

    private sealed record LotFact(
        Guid Id,
        Guid? PartnerId,
        Guid ProductId,
        string ProductName,
        decimal? UnitCost,
        decimal CurrentPrice,
        int Remaining,
        bool CountsAsInvestment,
        int EnteredInPeriod);

    private sealed record SaleFact(Guid? PartnerId, Guid ProductId, string ProductName, int Quantity, decimal Revenue, decimal? UnitCost);

    private sealed record LossFact(Guid? PartnerId, int Quantity, decimal? UnitCost);

    private sealed class Facts
    {
        private readonly IReadOnlyDictionary<Guid, string> _partners;

        public Facts(
            IReadOnlyDictionary<Guid, string> partners,
            IReadOnlyList<LotFact> lots,
            IReadOnlyList<SaleFact> sales,
            IReadOnlyList<LossFact> losses)
        {
            _partners = partners;
            Lots = lots;
            Sales = sales;
            Losses = losses;
        }

        public IReadOnlyList<LotFact> Lots { get; }

        public IReadOnlyList<SaleFact> Sales { get; }

        public IReadOnlyList<LossFact> Losses { get; }

        public IEnumerable<Guid?> PartnerKeys() =>
            Lots.Select(lot => lot.PartnerId).Concat(Sales.Select(sale => sale.PartnerId)).Concat(Losses.Select(loss => loss.PartnerId)).Distinct();

        public string PartnerName(Guid? key) => key is { } id && _partners.TryGetValue(id, out var name) ? name : NoPartnerName;

        public LotFact[] LotsOf(Guid? key) => Lots.Where(lot => lot.PartnerId == key).ToArray();

        public SaleFact[] SalesOf(Guid? key) => Sales.Where(sale => sale.PartnerId == key).ToArray();

        public LossFact[] LossesOf(Guid? key) => Losses.Where(loss => loss.PartnerId == key).ToArray();
    }
}
