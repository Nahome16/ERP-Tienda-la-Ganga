using System.Globalization;
using LaGanga.Application.Common;
using LaGanga.Application.Inventory;
using LaGanga.Application.Settings;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Inventory;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Inventory;

public sealed class InventoryService : IInventoryService
{
    private readonly LaGangaDbContext dbContext;
    private readonly IAuditWriter audit;
    private readonly TimeProvider timeProvider;
    private readonly LotService lots;

    public InventoryService(LaGangaDbContext dbContext, IAuditWriter audit, TimeProvider timeProvider)
    {
        this.dbContext = dbContext;
        this.audit = audit;
        this.timeProvider = timeProvider;
        lots = new LotService(dbContext);
    }

    public async Task<InventorySummaryDto> GetSummaryAsync(CancellationToken cancellationToken)
    {
        var threshold = await dbContext.Settings.AsNoTracking().Select(settings => settings.LowStockThreshold).SingleAsync(cancellationToken);
        var rows = dbContext.Variants.AsNoTracking()
            .Join(dbContext.StockBalances, variant => variant.Id, balance => balance.VariantId, (variant, balance) => balance.Quantity);
        return new InventorySummaryDto(
            await rows.SumAsync(quantity => (int?)quantity, cancellationToken) ?? 0,
            await dbContext.Variants.CountAsync(cancellationToken),
            await rows.CountAsync(quantity => quantity > 0 && quantity <= threshold, cancellationToken),
            await rows.CountAsync(quantity => quantity == 0, cancellationToken),
            await rows.CountAsync(quantity => quantity < 0, cancellationToken));
    }

    public async Task<PageResult<InventoryRowDto>> ListAsync(
        InventoryQuery query,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(actor);

        var threshold = await dbContext.Settings.AsNoTracking().Select(settings => settings.LowStockThreshold).SingleAsync(cancellationToken);
        var rows =
            from variant in dbContext.Variants.AsNoTracking()
            join product in dbContext.Products on variant.ProductId equals product.Id
            join category in dbContext.Categories on product.CategoryId equals category.Id
            join brand in dbContext.Brands on product.BrandId equals brand.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            join balance in dbContext.StockBalances on variant.Id equals balance.VariantId into balances
            from balance in balances.DefaultIfEmpty()
            select new
            {
                VariantId = variant.Id,
                ProductId = product.Id,
                ProductName = product.Name,
                CategoryName = category.Name,
                BrandName = brand.Name,
                SizeName = size.Name,
                SizeOrder = size.SortOrder,
                ColorName = color.Name,
                variant.Barcode,
                Price = variant.PriceOverride ?? product.BasePrice,
                Stock = balance == null ? 0 : balance.Quantity,
                variant.Cost,
            };

        var canSeePartners = actor.Has(PermissionNames.InvestmentRead);
        Guid? partnerFilter = null;
        var withoutPartner = false;
        if (canSeePartners && !string.IsNullOrWhiteSpace(query.PartnerId))
        {
            if (string.Equals(query.PartnerId.Trim(), "none", StringComparison.OrdinalIgnoreCase))
            {
                withoutPartner = true;
            }
            else if (Guid.TryParse(query.PartnerId, out var parsedPartner))
            {
                partnerFilter = parsedPartner;
            }
        }

        if (partnerFilter is { } filterPartner)
        {
            rows = rows.Where(row => dbContext.StockLots.Any(lot => lot.VariantId == row.VariantId && lot.PartnerId == filterPartner && lot.QuantityRemaining > 0));
        }
        else if (withoutPartner)
        {
            rows = rows.Where(row => dbContext.StockLots.Any(lot => lot.VariantId == row.VariantId && lot.PartnerId == null && lot.QuantityRemaining > 0));
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var pattern = $"%{query.Search.Trim().Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal)}%";
            rows = rows.Where(row =>
                EF.Functions.ILike(row.ProductName, pattern) ||
                EF.Functions.ILike(row.BrandName, pattern) ||
                EF.Functions.ILike(row.SizeName, pattern) ||
                EF.Functions.ILike(row.ColorName, pattern) ||
                EF.Functions.ILike(row.Barcode, pattern));
        }

        switch (query.Filter?.Trim().ToUpperInvariant())
        {
            case "LOW":
                rows = rows.Where(row => row.Stock > 0 && row.Stock <= threshold);
                break;
            case "OUT":
                rows = rows.Where(row => row.Stock == 0);
                break;
            case "NEGATIVE":
                rows = rows.Where(row => row.Stock < 0);
                break;
        }

        var total = await rows.CountAsync(cancellationToken);
        var page = await rows
            .OrderBy(row => row.ProductName).ThenBy(row => row.SizeOrder).ThenBy(row => row.ColorName).ThenBy(row => row.VariantId)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .ToListAsync(cancellationToken);
        var includeCost = actor.CanSeeCosts;
        var pageVariantIds = page.Select(row => row.VariantId).ToArray();
        var partnerUnits = new Dictionary<Guid, List<PartnerUnitsDto>>();
        if (canSeePartners && pageVariantIds.Length > 0)
        {
            var lotRows = await (
                from lot in dbContext.StockLots.AsNoTracking()
                where pageVariantIds.Contains(lot.VariantId) && lot.QuantityRemaining > 0
                join partner in dbContext.Partners on lot.PartnerId equals partner.Id into partners
                from partner in partners.DefaultIfEmpty()
                select new { lot.VariantId, lot.PartnerId, Name = partner == null ? "Sin socio" : partner.Name, lot.QuantityRemaining })
                .ToListAsync(cancellationToken);
            foreach (var group in lotRows.GroupBy(lot => lot.VariantId))
            {
                partnerUnits[group.Key] = group
                    .GroupBy(lot => new { lot.PartnerId, lot.Name })
                    .Select(unit => new PartnerUnitsDto(unit.Key.PartnerId, unit.Key.Name, unit.Sum(lot => lot.QuantityRemaining)))
                    .OrderByDescending(unit => unit.Units).ToList();
            }
        }

        var items = page.Select(row => new InventoryRowDto(
            row.VariantId,
            row.ProductId,
            row.ProductName,
            row.CategoryName,
            row.SizeName,
            row.ColorName,
            row.Barcode,
            row.Price,
            row.Stock,
            includeCost ? row.Cost : null,
            includeCost && row.Cost is { } cost ? Math.Round(cost * row.Stock, 2) : null,
            canSeePartners && (partnerFilter is not null || withoutPartner)
                ? partnerUnits.GetValueOrDefault(row.VariantId)?.Where(unit => unit.PartnerId == partnerFilter).Sum(unit => unit.Units) ?? 0
                : null,
            canSeePartners ? partnerUnits.GetValueOrDefault(row.VariantId) ?? [] : null)).ToArray();
        return Paging.Create(items, query.Page, query.PageSize, total);
    }

    public async Task<ServiceResult<PageResult<KardexRowDto>>> GetKardexAsync(
        Guid variantId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.Variants.AnyAsync(variant => variant.Id == variantId, cancellationToken))
        {
            return Result.Fail<PageResult<KardexRowDto>>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa variante.");
        }

        var movements = dbContext.Movements.AsNoTracking().Where(movement => movement.VariantId == variantId);
        var total = await movements.CountAsync(cancellationToken);
        var rows = await (
            from movement in movements.OrderByDescending(m => m.CreatedAtUtc).ThenByDescending(m => m.Id)
                .Skip((page - 1) * pageSize).Take(pageSize)
            join user in dbContext.Users on movement.UserId equals user.Id into users
            from user in users.DefaultIfEmpty()
            join sale in dbContext.Sales on movement.SaleId equals sale.Id into sales
            from sale in sales.DefaultIfEmpty()
            orderby movement.CreatedAtUtc descending, movement.Id descending
            select new { movement, UserName = user == null ? "Sistema" : user.DisplayName, SaleNumber = sale == null ? (long?)null : sale.Number })
            .ToListAsync(cancellationToken);
        var items = rows.Select(row => new KardexRowDto(
            row.movement.Type,
            row.movement.Quantity,
            row.movement.BalanceAfter,
            row.movement.Reason,
            row.SaleNumber is { } number ? FormatSaleNumber(number) : null,
            row.UserName,
            row.movement.CreatedAtUtc)).ToArray();
        return Result.Ok(Paging.Create(items, page, pageSize, total));
    }

    public async Task<ServiceResult<AdjustmentResultDto>> AdjustAsync(
        AdjustmentInput input,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var reason = input.Reason?.Trim() ?? string.Empty;
        if (reason.Length is < 3 or > 500)
        {
            return Invalid("reason", "El motivo es obligatorio (entre 3 y 500 caracteres).");
        }

        if (input.Delta == 0 ||
            (input.Kind == AdjustmentKind.Entry && input.Delta < 0) ||
            (input.Kind == AdjustmentKind.Loss && input.Delta > 0))
        {
            return Invalid("delta", input.Kind switch
            {
                AdjustmentKind.Entry => "Una entrada debe sumar unidades (cantidad positiva).",
                AdjustmentKind.Loss => "Una pérdida debe restar unidades (cantidad negativa).",
                _ => "La cantidad no puede ser cero.",
            });
        }

        var variant = await dbContext.Variants.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.Id == input.VariantId, cancellationToken);
        if (variant is null)
        {
            return Result.Fail<AdjustmentResultDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa variante.");
        }

        // Socio, costo y precio de la entrada: solo quien administra la inversión puede indicarlos.
        var hasInvestmentData = input.PartnerId is not null || input.UnitCost is not null || input.UnitPrice is not null;
        if (hasInvestmentData && !actor.Has(PermissionNames.InvestmentRead))
        {
            return Result.Fail<AdjustmentResultDto>(ServiceErrorKind.Forbidden, "partner_not_allowed", "Tu cuenta no puede indicar socio, costo ni precio al ingresar mercadería.");
        }

        if (hasInvestmentData && input.Delta < 0)
        {
            return Result.Fail<AdjustmentResultDto>(ServiceErrorKind.Validation, "validation_failed", "El socio, el costo y el precio solo aplican a entradas de mercadería.", "partnerId");
        }

        if (input.UnitCost is < 0 || input.UnitPrice is < 0)
        {
            return Result.Fail<AdjustmentResultDto>(ServiceErrorKind.Validation, "validation_failed", "El costo y el precio no pueden ser negativos.", "unitCost");
        }

        if (input.PartnerId is { } partnerId &&
            !await dbContext.Partners.AnyAsync(partner => partner.Id == partnerId && partner.IsActive, cancellationToken))
        {
            return Result.Fail<AdjustmentResultDto>(ServiceErrorKind.Validation, "validation_failed", "El socio elegido no existe o está inactivo.", "partnerId");
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var balance = await dbContext.StockBalances
            .FromSqlInterpolated($"SELECT * FROM inventory.stock_balances WHERE \"VariantId\" = {input.VariantId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (balance is null)
        {
            balance = new StockBalance(input.VariantId, 0);
            dbContext.StockBalances.Add(balance);
        }

        var newQuantity = balance.Quantity + input.Delta;
        if (newQuantity < 0)
        {
            return Result.Fail<AdjustmentResultDto>(
                ServiceErrorKind.Unprocessable,
                "negative_stock",
                $"El ajuste dejaría el saldo en {newQuantity}. Hay {balance.Quantity} unidades disponibles.");
        }

        var balanceBefore = balance.Quantity;
        balance.Quantity = newQuantity;
        var now = timeProvider.GetUtcNow();
        if (input.Delta > 0)
        {
            var basePrice = await dbContext.Products.Where(product => product.Id == variant.ProductId).Select(product => product.BasePrice).SingleAsync(cancellationToken);
            lots.AddLot(
                variant.Id,
                input.PartnerId,
                input.Kind == AdjustmentKind.Entry ? LotSource.Entry : LotSource.Adjustment,
                input.Delta,
                balanceBefore,
                input.UnitCost ?? variant.Cost,
                input.UnitPrice ?? variant.PriceOverride ?? basePrice,
                reason,
                actor.UserId,
                now);
        }
        else
        {
            await lots.ConsumeAsync(variant.Id, -input.Delta, AllocationKind.Loss, null, null, now, cancellationToken);
        }

        await lots.ReconcileAsync(variant.Id, newQuantity, now, cancellationToken);
        var type = input.Kind switch
        {
            AdjustmentKind.Entry => MovementType.Entry,
            AdjustmentKind.Loss => MovementType.Loss,
            _ => MovementType.Adjustment,
        };
        dbContext.Movements.Add(new InventoryMovement(
            Guid.NewGuid(), input.VariantId, type, input.Delta, newQuantity, reason, null, actor.UserId, now));
        audit.Add(
            actor.UserId,
            "inventory.adjusted",
            "Variant",
            input.VariantId.ToString(),
            string.Create(CultureInfo.InvariantCulture, $"{type} de {input.Delta:+#;-#} unidad(es) en {variant.Barcode}: saldo {newQuantity}. Motivo: {reason}"));
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Result.Ok(new AdjustmentResultDto(input.VariantId, input.Delta, newQuantity));
    }

    internal static string FormatSaleNumber(long number) =>
        string.Create(CultureInfo.InvariantCulture, $"V-{number:D6}");

    private static ServiceResult<AdjustmentResultDto> Invalid(string field, string message) =>
        Result.Fail<AdjustmentResultDto>(ServiceErrorKind.Validation, "validation_failed", message, field);
}
