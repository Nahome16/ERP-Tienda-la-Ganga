using System.Globalization;
using LaGanga.Application.Common;
using LaGanga.Application.Sales;
using LaGanga.Application.Settings;
using LaGanga.Domain.Inventory;
using LaGanga.Domain.Sales;
using LaGanga.Infrastructure.Inventory;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LaGanga.Infrastructure.Sales;

/// <summary>
/// Cambios de talla o color: el cliente devuelve prendas de una venta y se lleva otra variante
/// del mismo producto. No mueve dinero; ajusta existencias, Kardex y las entradas por socio.
/// </summary>
public sealed class ExchangeService : IExchangeService
{
    private const int MaxItems = 50;
    private const int MaxQuantity = 1000;

    private readonly LaGangaDbContext dbContext;
    private readonly IAuditWriter audit;
    private readonly TimeProvider timeProvider;
    private readonly LotService lots;

    public ExchangeService(LaGangaDbContext dbContext, IAuditWriter audit, TimeProvider timeProvider)
    {
        this.dbContext = dbContext;
        this.audit = audit;
        this.timeProvider = timeProvider;
        lots = new LotService(dbContext);
    }

    public async Task<ServiceResult<ExchangeLookupDto>> LookupAsync(string? saleNumber, CancellationToken cancellationToken)
    {
        var digits = new string((saleNumber ?? string.Empty).Where(char.IsAsciiDigit).ToArray());
        if (!long.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var number) || number <= 0)
        {
            return Result.Fail<ExchangeLookupDto>(ServiceErrorKind.Validation, "validation_failed", "Escribí el número del recibo (por ejemplo V-000123).", "number");
        }

        var sale = await dbContext.Sales.AsNoTracking().Include(candidate => candidate.Lines)
            .SingleOrDefaultAsync(candidate => candidate.Number == number, cancellationToken);
        if (sale is null)
        {
            return Result.Fail<ExchangeLookupDto>(ServiceErrorKind.NotFound, "not_found", $"No encontramos el recibo {SaleNumber(number)}.");
        }

        var windowDays = await dbContext.Settings.AsNoTracking().Select(settings => settings.ExchangeWindowDays).SingleAsync(cancellationToken);
        var days = DaysSince(sale.CreatedAtUtc);
        var blockedReason = BlockedReason(sale, days, windowDays);

        var exchanged = await ExchangedBySaleLineAsync(sale.Id, cancellationToken);
        var lineVariantIds = sale.Lines.Select(line => line.VariantId).Distinct().ToArray();
        var productByVariant = await dbContext.Variants.AsNoTracking()
            .Where(variant => lineVariantIds.Contains(variant.Id))
            .ToDictionaryAsync(variant => variant.Id, variant => variant.ProductId, cancellationToken);
        var productIds = productByVariant.Values.Distinct().ToArray();
        var options = await (
            from variant in dbContext.Variants.AsNoTracking()
            where productIds.Contains(variant.ProductId)
            join product in dbContext.Products on variant.ProductId equals product.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            join balance in dbContext.StockBalances on variant.Id equals balance.VariantId into balances
            from balance in balances.DefaultIfEmpty()
            orderby size.SortOrder, size.Name, color.SortOrder, color.Name
            select new
            {
                variant.ProductId,
                Option = new ExchangeOptionDto(
                    variant.Id,
                    size.Name,
                    color.Name,
                    color.SwatchHex,
                    variant.Barcode,
                    balance == null ? 0 : balance.Quantity,
                    variant.PriceOverride ?? product.BasePrice,
                    variant.IsActive && product.IsActive),
            })
            .ToListAsync(cancellationToken);

        var lines = sale.Lines.Select(line =>
        {
            var productId = productByVariant[line.VariantId];
            var already = exchanged.GetValueOrDefault(line.Id);
            return new ExchangeableLineDto(
                line.Id,
                line.VariantId,
                productId,
                line.ProductName,
                line.SizeName,
                line.ColorName,
                line.Barcode,
                line.Quantity,
                already,
                Math.Max(line.Quantity - already, 0),
                line.UnitPrice,
                options.Where(option => option.ProductId == productId && option.Option.VariantId != line.VariantId)
                    .Select(option => option.Option).ToArray());
        }).ToArray();

        var history = await ListForSaleAsync(sale.Id, cancellationToken);
        return Result.Ok(new ExchangeLookupDto(
            sale.Id,
            SaleNumber(sale.Number),
            sale.CreatedAtUtc,
            sale.Status,
            sale.TotalNio,
            days,
            windowDays,
            blockedReason is null && lines.Any(line => line.Available > 0),
            blockedReason ?? (lines.All(line => line.Available == 0) ? "Todas las prendas de esta venta ya se cambiaron." : null),
            lines,
            history));
    }

    public async Task<ServiceResult<ExchangeResultDto>> RegisterAsync(ExchangeRequest request, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        var validation = ValidateShape(request);
        if (validation is not null)
        {
            return Result.Fail<ExchangeResultDto>(validation);
        }

        var existing = await FindByClientIdAsync(request.ClientExchangeId, cancellationToken);
        if (existing is not null)
        {
            return Result.Ok(new ExchangeResultDto(true, existing));
        }

        if (request.CashSessionId is { } sessionId)
        {
            var session = await dbContext.CashSessions.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.Id == sessionId, cancellationToken);
            if (session is null)
            {
                return Result.Fail<ExchangeResultDto>(ServiceErrorKind.Unprocessable, "session_not_found", "La caja indicada no existe.");
            }

            if (session.OpenedByUserId != actor.UserId)
            {
                return Result.Fail<ExchangeResultDto>(ServiceErrorKind.Forbidden, "session_not_yours", "Esa caja pertenece a otra persona.");
            }
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        // La venta se bloquea para que dos cambios simultáneos no devuelvan la misma prenda dos veces.
        var sale = await dbContext.Sales
            .FromSqlInterpolated($"SELECT * FROM sales.sales WHERE \"Id\" = {request.SaleId} FOR UPDATE")
            .Include(candidate => candidate.Lines)
            .SingleOrDefaultAsync(cancellationToken);
        if (sale is null)
        {
            return Result.Fail<ExchangeResultDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa venta.");
        }

        var windowDays = await dbContext.Settings.AsNoTracking().Select(settings => settings.ExchangeWindowDays).SingleAsync(cancellationToken);
        var blockedReason = BlockedReason(sale, DaysSince(sale.CreatedAtUtc), windowDays);
        if (blockedReason is not null)
        {
            return Result.Fail<ExchangeResultDto>(
                ServiceErrorKind.Unprocessable,
                sale.Status == SaleStatus.Voided ? "sale_voided" : "exchange_window_expired",
                blockedReason);
        }

        var linesById = sale.Lines.ToDictionary(line => line.Id);
        if (request.Items!.Any(item => !linesById.ContainsKey(item.SaleLineId)))
        {
            return Result.Fail<ExchangeResultDto>(ServiceErrorKind.Validation, "validation_failed", "Alguna prenda no pertenece a esta venta.", "items");
        }

        var exchanged = await ExchangedBySaleLineAsync(sale.Id, cancellationToken);
        foreach (var group in request.Items!.GroupBy(item => item.SaleLineId))
        {
            var line = linesById[group.Key];
            var available = line.Quantity - exchanged.GetValueOrDefault(line.Id);
            var wanted = group.Sum(item => item.Quantity);
            if (wanted > available)
            {
                return Result.Fail<ExchangeResultDto>(
                    ServiceErrorKind.Unprocessable,
                    "exceeds_sold_quantity",
                    available <= 0
                        ? $"{line.ProductName} ({line.SizeName}, {line.ColorName}) ya se cambió por completo."
                        : $"De {line.ProductName} ({line.SizeName}, {line.ColorName}) se pueden cambiar como máximo {available} unidad(es).");
            }
        }

        var variantIds = request.Items!.Select(item => item.NewVariantId)
            .Concat(sale.Lines.Select(line => line.VariantId))
            .Distinct().ToArray();
        var info = await (
            from variant in dbContext.Variants.AsNoTracking()
            where variantIds.Contains(variant.Id)
            join product in dbContext.Products on variant.ProductId equals product.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            select new VariantInfo(variant.Id, variant.ProductId, product.Name, size.Name, color.Name, variant.Barcode, variant.IsActive && product.IsActive))
            .ToDictionaryAsync(variant => variant.Id, cancellationToken);

        foreach (var item in request.Items!)
        {
            var line = linesById[item.SaleLineId];
            if (!info.TryGetValue(item.NewVariantId, out var target))
            {
                return Result.Fail<ExchangeResultDto>(ServiceErrorKind.Unprocessable, "variant_not_found", "La talla o color elegido ya no existe en el sistema.");
            }

            if (target.ProductId != info[line.VariantId].ProductId)
            {
                return Result.Fail<ExchangeResultDto>(
                    ServiceErrorKind.Unprocessable,
                    "different_product",
                    $"Solo se cambia por otra talla o color de {line.ProductName}.");
            }

            if (target.Id == line.VariantId)
            {
                return Result.Fail<ExchangeResultDto>(ServiceErrorKind.Validation, "same_variant", "Elegí una talla o color distinto al que se devuelve.", "items");
            }

            if (!target.IsActive)
            {
                return Result.Fail<ExchangeResultDto>(
                    ServiceErrorKind.Unprocessable,
                    "variant_inactive",
                    $"{target.ProductName} ({target.SizeName}, {target.ColorName}) está inactivo.");
            }
        }

        var balances = await LockBalancesAsync(variantIds, cancellationToken);
        foreach (var group in request.Items!.GroupBy(item => item.NewVariantId))
        {
            var wanted = group.Sum(item => item.Quantity);
            var available = balances.TryGetValue(group.Key, out var balance) ? balance.Quantity : 0;
            if (available < wanted)
            {
                var target = info[group.Key];
                return Result.Fail<ExchangeResultDto>(
                    ServiceErrorKind.Unprocessable,
                    "insufficient_stock",
                    available <= 0
                        ? $"No hay existencias de {target.ProductName} ({target.SizeName}, {target.ColorName})."
                        : $"Solo quedan {available} unidad(es) de {target.ProductName} ({target.SizeName}, {target.ColorName}).");
            }
        }

        var now = timeProvider.GetUtcNow();
        var exchange = new SaleExchange(Guid.NewGuid(), request.ClientExchangeId, sale.Id, request.CashSessionId, actor.UserId, now, request.Note);
        var reason = $"Cambio de talla de la venta {SaleNumber(sale.Number)}";
        foreach (var item in request.Items!)
        {
            var line = linesById[item.SaleLineId];
            var returned = info[line.VariantId];
            var target = info[item.NewVariantId];

            var returnedBalance = BalanceFor(balances, returned.Id);
            returnedBalance.Quantity += item.Quantity;
            dbContext.Movements.Add(new InventoryMovement(
                Guid.NewGuid(), returned.Id, MovementType.ExchangeIn, item.Quantity, returnedBalance.Quantity, reason, sale.Id, actor.UserId, now));

            var targetBalance = BalanceFor(balances, target.Id);
            targetBalance.Quantity -= item.Quantity;
            dbContext.Movements.Add(new InventoryMovement(
                Guid.NewGuid(), target.Id, MovementType.ExchangeOut, -item.Quantity, targetBalance.Quantity, reason, sale.Id, actor.UserId, now));

            // Las unidades devueltas vuelven a su entrada; las entregadas salen de la más antigua (PEPS),
            // y quedan ligadas a la misma línea de venta para que el socio reciba lo cobrado.
            await lots.ReturnFromSaleLineAsync(line.Id, line.VariantId, item.Quantity, cancellationToken);
            await lots.ConsumeAsync(target.Id, item.Quantity, AllocationKind.Sale, sale.Id, line.Id, now, cancellationToken);

            exchange.AddLine(new SaleExchangeLine(
                Guid.NewGuid(),
                exchange.Id,
                line.Id,
                line.ProductName,
                item.Quantity,
                line.UnitPrice,
                returned.Id,
                returned.SizeName,
                returned.ColorName,
                returned.Barcode,
                target.Id,
                target.SizeName,
                target.ColorName,
                target.Barcode));
        }

        foreach (var (variantId, balance) in balances)
        {
            await lots.ReconcileAsync(variantId, balance.Quantity, now, cancellationToken);
        }

        dbContext.SaleExchanges.Add(exchange);
        var units = exchange.Lines.Sum(line => line.Quantity);
        audit.Add(actor.UserId, "sale.exchanged", "Sale", sale.Id.ToString(), $"Cambio de talla de {units} prenda(s) de la venta {SaleNumber(sale.Number)}.");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // El mismo cambio llegó dos veces: se devuelve el ya guardado.
            await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            var winner = await FindByClientIdAsync(request.ClientExchangeId, cancellationToken);
            if (winner is not null)
            {
                return Result.Ok(new ExchangeResultDto(true, winner));
            }

            throw;
        }

        var dto = await FindByClientIdAsync(request.ClientExchangeId, cancellationToken);
        return Result.Ok(new ExchangeResultDto(false, dto!));
    }

    private int DaysSince(DateTimeOffset saleCreatedAtUtc) =>
        ExchangePolicy.DaysSince(BusinessTime.ToBusinessDate(saleCreatedAtUtc), BusinessTime.ToBusinessDate(timeProvider.GetUtcNow()));

    private static string? BlockedReason(Sale sale, int days, int windowDays)
    {
        if (sale.Status == SaleStatus.Voided)
        {
            return "Esta venta fue anulada; no admite cambios.";
        }

        if (days > windowDays)
        {
            return windowDays == 0
                ? "Los cambios solo se aceptan el mismo día de la compra."
                : $"Pasaron {days} días desde la compra y el plazo para cambios es de {windowDays} días.";
        }

        return null;
    }

    private static ServiceError? ValidateShape(ExchangeRequest request)
    {
        static ServiceError Bad(string message, string field) =>
            new(ServiceErrorKind.Validation, "validation_failed", message, field);

        if (request.ClientExchangeId == Guid.Empty)
        {
            return Bad("Falta el identificador del cambio.", "clientExchangeId");
        }

        if (request.SaleId == Guid.Empty)
        {
            return Bad("Falta la venta.", "saleId");
        }

        if (request.Items is not { Count: > 0 and <= MaxItems })
        {
            return Bad("Elegí al menos una prenda para cambiar.", "items");
        }

        if (request.Items.Any(item => item.Quantity is < 1 or > MaxQuantity || item.SaleLineId == Guid.Empty || item.NewVariantId == Guid.Empty))
        {
            return Bad("Cada prenda necesita una cantidad entera positiva y la talla o color nuevo.", "items");
        }

        if (request.Note is { Length: > SaleExchange.NoteMaxLength })
        {
            return Bad("La nota admite hasta 500 caracteres.", "note");
        }

        return null;
    }

    private async Task<Dictionary<Guid, int>> ExchangedBySaleLineAsync(Guid saleId, CancellationToken cancellationToken) =>
        await (
            from line in dbContext.SaleExchangeLines.AsNoTracking()
            join exchange in dbContext.SaleExchanges on line.ExchangeId equals exchange.Id
            where exchange.SaleId == saleId
            group line by line.SaleLineId into lines
            select new { SaleLineId = lines.Key, Quantity = lines.Sum(line => line.Quantity) })
            .ToDictionaryAsync(row => row.SaleLineId, row => row.Quantity, cancellationToken);

    private StockBalance BalanceFor(Dictionary<Guid, StockBalance> balances, Guid variantId)
    {
        if (!balances.TryGetValue(variantId, out var balance))
        {
            balance = new StockBalance(variantId, 0);
            dbContext.StockBalances.Add(balance);
            balances[variantId] = balance;
        }

        return balance;
    }

    private async Task<Dictionary<Guid, StockBalance>> LockBalancesAsync(Guid[] variantIds, CancellationToken cancellationToken)
    {
        var balances = await dbContext.StockBalances
            .FromSqlInterpolated($"SELECT * FROM inventory.stock_balances WHERE \"VariantId\" = ANY({variantIds}) ORDER BY \"VariantId\" FOR UPDATE")
            .ToListAsync(cancellationToken);
        return balances.ToDictionary(balance => balance.VariantId);
    }

    private async Task<ExchangeDto?> FindByClientIdAsync(Guid clientExchangeId, CancellationToken cancellationToken)
    {
        var exchange = await dbContext.SaleExchanges.AsNoTracking().Include(candidate => candidate.Lines)
            .SingleOrDefaultAsync(candidate => candidate.ClientExchangeId == clientExchangeId, cancellationToken);
        return exchange is null ? null : (await MapAsync([exchange], cancellationToken))[0];
    }

    private async Task<IReadOnlyList<ExchangeDto>> ListForSaleAsync(Guid saleId, CancellationToken cancellationToken)
    {
        var exchanges = await dbContext.SaleExchanges.AsNoTracking().Include(candidate => candidate.Lines)
            .Where(candidate => candidate.SaleId == saleId)
            .OrderBy(candidate => candidate.CreatedAtUtc).ThenBy(candidate => candidate.Number)
            .ToListAsync(cancellationToken);
        return await MapAsync(exchanges, cancellationToken);
    }

    private async Task<IReadOnlyList<ExchangeDto>> MapAsync(List<SaleExchange> exchanges, CancellationToken cancellationToken)
    {
        if (exchanges.Count == 0)
        {
            return [];
        }

        var userIds = exchanges.Select(exchange => exchange.UserId).Distinct().ToArray();
        var names = await dbContext.Users.AsNoTracking().Where(user => userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
        var saleIds = exchanges.Select(exchange => exchange.SaleId).Distinct().ToArray();
        var saleNumbers = await dbContext.Sales.AsNoTracking().Where(sale => saleIds.Contains(sale.Id))
            .ToDictionaryAsync(sale => sale.Id, sale => sale.Number, cancellationToken);
        var sessionIds = exchanges.Where(exchange => exchange.CashSessionId is not null).Select(exchange => exchange.CashSessionId!.Value).Distinct().ToArray();
        var registers = await (
            from session in dbContext.CashSessions.AsNoTracking()
            where sessionIds.Contains(session.Id)
            join register in dbContext.CashRegisters on session.RegisterId equals register.Id
            select new { session.Id, register.Name })
            .ToDictionaryAsync(row => row.Id, row => row.Name, cancellationToken);

        return exchanges.Select(exchange => new ExchangeDto(
            exchange.Id,
            ExchangeNumber(exchange.Number),
            exchange.SaleId,
            SaleNumber(saleNumbers[exchange.SaleId]),
            exchange.CreatedAtUtc,
            names.GetValueOrDefault(exchange.UserId, "—"),
            exchange.CashSessionId is { } sessionId ? registers.GetValueOrDefault(sessionId) : null,
            exchange.Note,
            exchange.Lines.Select(line => new ExchangeLineDto(
                line.ProductName,
                line.Quantity,
                line.UnitPrice,
                line.ReturnedSizeName,
                line.ReturnedColorName,
                line.ReturnedBarcode,
                line.NewSizeName,
                line.NewColorName,
                line.NewBarcode)).ToArray()))
            .ToArray();
    }

    private static string SaleNumber(long number) => string.Create(CultureInfo.InvariantCulture, $"V-{number:D6}");

    private static string ExchangeNumber(long number) => string.Create(CultureInfo.InvariantCulture, $"CT-{number:D6}");

    private sealed record VariantInfo(
        Guid Id,
        Guid ProductId,
        string ProductName,
        string SizeName,
        string ColorName,
        string Barcode,
        bool IsActive);
}
