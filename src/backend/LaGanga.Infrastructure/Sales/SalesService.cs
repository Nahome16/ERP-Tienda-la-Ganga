using System.Globalization;
using LaGanga.Application.Common;
using LaGanga.Application.Sales;
using LaGanga.Application.Settings;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Inventory;
using LaGanga.Domain.Sales;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LaGanga.Infrastructure.Sales;

public sealed class SalesService : ISalesService
{
    private readonly LaGangaDbContext dbContext;
    private readonly IAuditWriter audit;
    private readonly TimeProvider timeProvider;
    private readonly Inventory.LotService lots;

    public SalesService(LaGangaDbContext dbContext, IAuditWriter audit, TimeProvider timeProvider)
    {
        this.dbContext = dbContext;
        this.audit = audit;
        this.timeProvider = timeProvider;
        lots = new Inventory.LotService(dbContext);
    }

    private const int MaxLines = 200;
    private const int MaxQuantity = 1000;
    private const int MaxPayments = 20;

    public async Task<ServiceResult<SaleResultDto>> RegisterAsync(
        SaleRequest request,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        var validation = ValidateShape(request);
        if (validation is not null)
        {
            return Result.Fail<SaleResultDto>(validation);
        }

        var existing = await FindByClientIdAsync(request.ClientSaleId, cancellationToken);
        if (existing is not null)
        {
            return Result.Ok(new SaleResultDto(true, existing));
        }

        var session = await dbContext.CashSessions.AsNoTracking().Include(candidate => candidate.Register)
            .SingleOrDefaultAsync(candidate => candidate.Id == request.CashSessionId, cancellationToken);
        if (session is null)
        {
            return Result.Fail<SaleResultDto>(ServiceErrorKind.Unprocessable, "session_not_found", "La caja de esta venta no existe.");
        }

        if (session.OpenedByUserId != actor.UserId)
        {
            return Result.Fail<SaleResultDto>(ServiceErrorKind.Forbidden, "session_not_yours", "Esta venta pertenece a la caja de otra persona.");
        }

        var settings = await dbContext.Settings.AsNoTracking().SingleAsync(cancellationToken);
        var lines = request.Lines!;
        var variantIds = lines.Select(line => line.VariantId).Distinct().ToArray();
        var variantInfo = await (
            from variant in dbContext.Variants.AsNoTracking()
            where variantIds.Contains(variant.Id)
            join product in dbContext.Products on variant.ProductId equals product.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            select new VariantInfo(
                variant.Id,
                product.Name,
                size.Name,
                color.Name,
                variant.Barcode,
                variant.PriceOverride ?? product.BasePrice,
                variant.IsActive && product.IsActive))
            .ToDictionaryAsync(info => info.Id, cancellationToken);
        if (variantInfo.Count != variantIds.Length)
        {
            return Result.Fail<SaleResultDto>(ServiceErrorKind.Unprocessable, "variant_not_found", "Alguno de los productos de la venta ya no existe en el sistema.");
        }

        var reviewNotes = new List<string>();
        var receivedAtUtc = timeProvider.GetUtcNow();
        var sale = new Sale(
            Guid.NewGuid(),
            request.ClientSaleId,
            session.Id,
            actor.UserId,
            request.Channel,
            request.IsOffline ? request.CreatedAtUtc.ToUniversalTime() : receivedAtUtc,
            receivedAtUtc,
            request.IsOffline,
            request.Note,
            request.CustomerName);

        // Totales: se calculan aquí; lo que mande el equipo no se toma como definitivo.
        foreach (var line in lines)
        {
            var info = variantInfo[line.VariantId];
            var unitPrice = Money.Round(line.UnitPrice);
            if (!request.IsOffline && unitPrice != info.CurrentPrice)
            {
                return Result.Fail<SaleResultDto>(
                    ServiceErrorKind.Conflict,
                    "price_changed",
                    $"El precio de {info.ProductName} cambió a C$ {info.CurrentPrice:0.00}. Actualizá el punto de venta antes de cobrar.");
            }

            var lineTotal = Money.Round(line.Quantity * unitPrice);
            sale.AddLine(new SaleLine(
                Guid.NewGuid(), sale.Id, info.Id, info.ProductName, info.SizeName, info.ColorName, info.Barcode,
                line.Quantity, unitPrice, lineTotal));
            if (request.IsOffline && unitPrice != info.CurrentPrice)
            {
                reviewNotes.Add($"Precio distinto del vigente en {info.ProductName} ({info.Barcode}): se cobró {unitPrice:0.00} y el sistema indica {info.CurrentPrice:0.00}.");
            }

            if (!info.IsActive)
            {
                reviewNotes.Add($"{info.ProductName} ({info.Barcode}) estaba inactivo.");
            }
        }

        var subtotal = Money.Round(sale.Lines.Sum(line => line.LineTotalNio));
        var discountError = ComputeDiscount(request.Discount, subtotal, out var discountNio);
        if (discountError is not null)
        {
            return Result.Fail<SaleResultDto>(discountError);
        }

        var total = Money.Round(subtotal - discountNio);
        var discountPercent = subtotal > 0 ? Money.Round(discountNio / subtotal * 100) : 0m;
        DiscountApproval? approval = null;
        if (discountPercent > settings.SellerDiscountLimitPercent && !actor.Has(PermissionNames.SaleDiscountUnlimited))
        {
            approval = request.DiscountApprovalId is { } approvalId
                ? await dbContext.DiscountApprovals.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.Id == approvalId, cancellationToken)
                : null;
            if (approval is null ||
                approval.RequestedByUserId != actor.UserId ||
                approval.UsedBySaleId is not null ||
                timeProvider.GetUtcNow() > approval.ExpiresAtUtc)
            {
                return Result.Fail<SaleResultDto>(
                    ServiceErrorKind.Unprocessable,
                    "discount_not_authorized",
                    $"Un descuento de {discountPercent:0.##}% supera el límite de {settings.SellerDiscountLimitPercent:0.##}% y requiere autorización de un administrador.");
            }
        }

        var paymentError = BuildPayments(request, sale, total, settings.UsdRate, reviewNotes, out var paidNio, out var cashNio);
        if (paymentError is not null)
        {
            return Result.Fail<SaleResultDto>(paymentError);
        }

        var change = Money.Round(paidNio - total);
        if (change > cashNio)
        {
            return Result.Fail<SaleResultDto>(ServiceErrorKind.Unprocessable, "payment_exceeds_total", "El pago supera el total y el cambio solo puede salir del efectivo.");
        }

        sale.SetTotals(
            subtotal,
            request.Discount?.Type,
            request.Discount is null ? null : Money.Round(request.Discount.Value),
            discountNio,
            total,
            change,
            approval?.Id);

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        session = await LockCashSessionAsync(session.Id, cancellationToken);
        if (session is null)
        {
            return Result.Fail<SaleResultDto>(ServiceErrorKind.Unprocessable, "session_not_found", "La caja de esta venta no existe.");
        }

        if (!session.IsOpen)
        {
            if (!request.IsOffline)
            {
                return Result.Fail<SaleResultDto>(
                    ServiceErrorKind.Conflict,
                    "session_closed",
                    "La caja ya fue cerrada. Abrí un nuevo turno antes de registrar otra venta.");
            }

            reviewNotes.Add("La venta se hizo sin conexión y llegó después del cierre de caja; debe conciliarse.");
        }

        if (approval is not null)
        {
            approval = await LockDiscountApprovalAsync(approval.Id, cancellationToken);
            if (approval is null ||
                approval.RequestedByUserId != actor.UserId ||
                approval.UsedBySaleId is not null ||
                timeProvider.GetUtcNow() > approval.ExpiresAtUtc)
            {
                return Result.Fail<SaleResultDto>(
                    ServiceErrorKind.Unprocessable,
                    "discount_not_authorized",
                    "La autorización de descuento ya fue usada o venció. Solicitá una nueva.");
            }
        }

        var balances = await LockBalancesAsync(variantIds, cancellationToken);
        var now = timeProvider.GetUtcNow();

        // Regla: no se vende lo que no hay. Una venta hecha CON conexión se rechaza si no alcanza el
        // stock (con las filas bloqueadas, así dos cajas no pueden llevarse la última unidad).
        // Una venta hecha SIN conexión no se puede rechazar: la prenda y el dinero ya cambiaron de
        // manos; se acepta y queda marcada para revisión (el POS ya la validó contra su copia local).
        if (!request.IsOffline)
        {
            foreach (var group in lines.GroupBy(line => line.VariantId))
            {
                var wanted = group.Sum(line => line.Quantity);
                var available = balances.TryGetValue(group.Key, out var current) ? current.Quantity : 0;
                if (available < wanted)
                {
                    var info = variantInfo[group.Key];
                    return Result.Fail<SaleResultDto>(
                        ServiceErrorKind.Unprocessable,
                        "insufficient_stock",
                        available <= 0
                            ? $"Sin existencias de {info.ProductName} ({info.SizeName}, {info.ColorName})."
                            : $"Solo quedan {available} unidad(es) de {info.ProductName} ({info.SizeName}, {info.ColorName}) y se piden {wanted}.");
                }
            }
        }

        foreach (var group in lines.GroupBy(line => line.VariantId))
        {
            var quantity = group.Sum(line => line.Quantity);
            if (!balances.TryGetValue(group.Key, out var balance))
            {
                balance = new StockBalance(group.Key, 0);
                dbContext.StockBalances.Add(balance);
                balances[group.Key] = balance;
            }

            balance.Quantity -= quantity;
            if (balance.Quantity < 0)
            {
                var info = variantInfo[group.Key];
                reviewNotes.Add($"Stock insuficiente en {info.ProductName} ({info.Barcode}): el saldo quedó en {balance.Quantity}.");
            }

            dbContext.Movements.Add(new InventoryMovement(
                Guid.NewGuid(), group.Key, MovementType.Sale, -quantity, balance.Quantity, null, sale.Id, actor.UserId, now));
        }

        // Cada línea descuenta de las entradas más antiguas (PEPS): así se sabe de qué socio fue lo vendido.
        foreach (var saleLine in sale.Lines)
        {
            await lots.ConsumeAsync(saleLine.VariantId, saleLine.Quantity, AllocationKind.Sale, sale.Id, saleLine.Id, now, cancellationToken);
        }

        foreach (var (variantId, balance) in balances)
        {
            await lots.ReconcileAsync(variantId, balance.Quantity, now, cancellationToken);
        }

        foreach (var note in reviewNotes)
        {
            sale.FlagForReview(note);
        }

        approval?.MarkUsed(sale.Id);
        dbContext.Sales.Add(sale);
        audit.Add(
            actor.UserId,
            "sale.confirmed",
            "Sale",
            sale.Id.ToString(),
            string.Create(CultureInfo.InvariantCulture, $"Venta de C$ {total:0.00} en {session.Register.Name}{(sale.IsOffline ? " (hecha sin conexión)" : string.Empty)}{(discountNio > 0 ? $", descuento C$ {discountNio:0.00}" : string.Empty)}{(sale.RequiresReview ? " — requiere revisión" : string.Empty)}."));
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Otro envío de la misma venta llegó primero: se devuelve la ya guardada.
            await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            var winner = await FindByClientIdAsync(request.ClientSaleId, cancellationToken);
            if (winner is not null)
            {
                return Result.Ok(new SaleResultDto(true, winner));
            }

            throw;
        }

        var dto = await FindByClientIdAsync(request.ClientSaleId, cancellationToken);
        return Result.Ok(new SaleResultDto(false, dto!));
    }

    public async Task<PageResult<SaleDto>> ListAsync(SaleListQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var sales = dbContext.Sales.AsNoTracking().AsQueryable();
        if (query.From is { } from)
        {
            var start = BusinessTime.DayRangeUtc(from).StartUtc;
            sales = sales.Where(sale => sale.CreatedAtUtc >= start);
        }

        if (query.To is { } to)
        {
            var end = BusinessTime.DayRangeUtc(to).EndUtc;
            sales = sales.Where(sale => sale.CreatedAtUtc < end);
        }

        if (query.SessionId is { } sessionId)
        {
            sales = sales.Where(sale => sale.CashSessionId == sessionId);
        }

        switch (query.Status?.Trim().ToUpperInvariant())
        {
            case "CONFIRMED":
                sales = sales.Where(sale => sale.Status == SaleStatus.Confirmed);
                break;
            case "VOIDED":
                sales = sales.Where(sale => sale.Status == SaleStatus.Voided);
                break;
        }

        if (query.NeedsReview == true)
        {
            sales = sales.Where(sale => sale.RequiresReview && sale.Status == SaleStatus.Confirmed);
        }

        if (!string.IsNullOrWhiteSpace(query.Number))
        {
            var digits = new string(query.Number.Where(char.IsAsciiDigit).ToArray());
            if (long.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var number))
            {
                sales = sales.Where(sale => sale.Number == number);
            }
            else
            {
                sales = sales.Where(_ => false);
            }
        }

        var total = await sales.CountAsync(cancellationToken);
        var page = await sales.OrderByDescending(sale => sale.CreatedAtUtc).ThenByDescending(sale => sale.Number)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Include(sale => sale.Lines).Include(sale => sale.Payments).Include(sale => sale.CashSession)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        return Paging.Create(await MapAsync(page, cancellationToken), query.Page, query.PageSize, total);
    }

    public async Task<ServiceResult<IReadOnlyList<SaleDto>>> ListBySessionAsync(
        Guid sessionId,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var session = await dbContext.CashSessions.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.Id == sessionId, cancellationToken);
        if (session is null)
        {
            return Result.Fail<IReadOnlyList<SaleDto>>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa caja.");
        }

        if (session.OpenedByUserId != actor.UserId && !actor.Has(PermissionNames.CashReportRead) && !actor.Has(PermissionNames.SaleRead))
        {
            return Result.Fail<IReadOnlyList<SaleDto>>(ServiceErrorKind.Forbidden, "forbidden", "No podés ver las ventas de una caja que no es tuya.");
        }

        var sales = await dbContext.Sales.AsNoTracking().Where(sale => sale.CashSessionId == sessionId)
            .OrderByDescending(sale => sale.CreatedAtUtc).ThenByDescending(sale => sale.Number)
            .Include(sale => sale.Lines).Include(sale => sale.Payments).Include(sale => sale.CashSession)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        return Result.Ok(await MapAsync(sales, cancellationToken));
    }

    public async Task<ServiceResult<SaleDto>> GetAsync(Guid id, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var sale = await LoadAsync(id, cancellationToken);
        if (sale is null)
        {
            return NotFound();
        }

        if (sale.CashSession.OpenedByUserId != actor.UserId && !actor.Has(PermissionNames.SaleRead) && !actor.Has(PermissionNames.CashReportRead))
        {
            return Result.Fail<SaleDto>(ServiceErrorKind.Forbidden, "forbidden", "No podés ver ventas de otra caja.");
        }

        return Result.Ok((await MapAsync([sale], cancellationToken))[0]);
    }

    public async Task<ServiceResult<SaleDto>> VoidAsync(
        Guid id,
        VoidSaleRequest request,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        var reason = request.Reason?.Trim() ?? string.Empty;
        if (reason.Length is < 5 or > 500)
        {
            return Result.Fail<SaleDto>(ServiceErrorKind.Validation, "validation_failed", "Indicá el motivo de la anulación (entre 5 y 500 caracteres).", "reason");
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var sale = await LoadForUpdateAsync(id, cancellationToken);
        if (sale is null)
        {
            return NotFound();
        }

        if (sale.Status == SaleStatus.Voided)
        {
            return Result.Fail<SaleDto>(ServiceErrorKind.Conflict, "already_voided", "Esta venta ya fue anulada.");
        }

        if (await dbContext.SaleExchanges.AnyAsync(exchange => exchange.SaleId == sale.Id, cancellationToken))
        {
            return Result.Fail<SaleDto>(
                ServiceErrorKind.Conflict,
                "sale_has_exchanges",
                "Esta venta tiene cambios de talla registrados y ya no se puede anular. Registrá un ajuste de inventario si hace falta.");
        }

        var cashSession = await LockCashSessionAsync(sale.CashSessionId, cancellationToken);
        if (cashSession is null)
        {
            return Result.Fail<SaleDto>(ServiceErrorKind.Conflict, "session_not_found", "La caja de esta venta ya no existe.");
        }

        if (!cashSession.IsOpen)
        {
            return Result.Fail<SaleDto>(
                ServiceErrorKind.Conflict,
                "cash_session_closed",
                "La caja de esta venta ya fue cerrada. Registrá una devolución o ajuste en el turno actual; el cierre histórico no puede modificarse.");
        }

        var now = timeProvider.GetUtcNow();
        var variantIds = sale.Lines.Select(line => line.VariantId).Distinct().ToArray();
        var balances = await LockBalancesAsync(variantIds, cancellationToken);
        foreach (var group in sale.Lines.GroupBy(line => line.VariantId))
        {
            if (!balances.TryGetValue(group.Key, out var balance))
            {
                balance = new StockBalance(group.Key, 0);
                dbContext.StockBalances.Add(balance);
            }

            var quantity = group.Sum(line => line.Quantity);
            balance.Quantity += quantity;
            dbContext.Movements.Add(new InventoryMovement(
                Guid.NewGuid(), group.Key, MovementType.SaleVoid, quantity, balance.Quantity, $"Anulación: {reason}", sale.Id, actor.UserId, now));
        }

        await lots.RestoreSaleAsync(sale.Id, cancellationToken);
        foreach (var (variantId, balance) in balances)
        {
            await lots.ReconcileAsync(variantId, balance.Quantity, now, cancellationToken);
        }

        sale.Void(actor.UserId, now, reason);
        audit.Add(actor.UserId, "sale.voided", "Sale", sale.Id.ToString(), string.Create(CultureInfo.InvariantCulture, $"Venta {InventoryNumber(sale.Number)} anulada. Motivo: {reason}"));
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Result.Ok((await MapAsync([sale], cancellationToken))[0]);
    }

    public async Task<ServiceResult<SaleDto>> ResolveReviewAsync(
        Guid id,
        ResolveReviewRequest request,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        var sale = await LoadAsync(id, cancellationToken, track: true);
        if (sale is null)
        {
            return NotFound();
        }

        if (!sale.RequiresReview)
        {
            return Result.Fail<SaleDto>(ServiceErrorKind.Conflict, "not_in_review", "Esta venta no está pendiente de revisión.");
        }

        sale.ResolveReview(request.Note ?? string.Empty);
        audit.Add(actor.UserId, "sale.review_resolved", "Sale", sale.Id.ToString(), $"Revisión resuelta de {InventoryNumber(sale.Number)}.");
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Ok((await MapAsync([sale], cancellationToken))[0]);
    }

    private static string InventoryNumber(long number) => string.Create(CultureInfo.InvariantCulture, $"V-{number:D6}");

    private static ServiceError? ValidateShape(SaleRequest request)
    {
        static ServiceError Bad(string message, string field) =>
            new(ServiceErrorKind.Validation, "validation_failed", message, field);

        if (request.ClientSaleId == Guid.Empty)
        {
            return Bad("Falta el identificador de la venta.", "clientSaleId");
        }

        if (request.Lines is not { Count: > 0 and <= MaxLines })
        {
            return Bad($"La venta debe tener entre 1 y {MaxLines} líneas.", "lines");
        }

        if (request.Lines.Any(line => line.Quantity is < 1 or > MaxQuantity || line.UnitPrice < 0 || line.UnitPrice > 100_000_000))
        {
            return Bad("Cada línea necesita una cantidad entera positiva y un precio válido.", "lines");
        }

        if (request.Note is { Length: > 500 })
        {
            return Bad("La nota admite hasta 500 caracteres.", "note");
        }

        if (request.CustomerName is { } customer && customer.Trim().Length > 120)
        {
            return Bad("El nombre del cliente admite hasta 120 caracteres.", "customerName");
        }

        if (request.CreatedAtUtc == default)
        {
            return Bad("Falta la fecha de la venta.", "createdAtUtc");
        }

        if (request.Payments is null || request.Payments.Count > MaxPayments)
        {
            return Bad($"La venta admite como máximo {MaxPayments} pagos.", "payments");
        }

        foreach (var payment in request.Payments)
        {
            if (Money.Round(payment.Amount) <= 0 || payment.Amount > 100_000_000)
            {
                return Bad("Cada pago debe ser mayor que cero.", "payments");
            }

            if (payment.Currency == Currency.USD &&
                (payment.ExchangeRate is null || Money.RoundRate(payment.ExchangeRate.Value) <= 0 || payment.ExchangeRate > 1_000_000))
            {
                return Bad("Los pagos en dólares necesitan la tasa de cambio usada.", "payments");
            }

            if (payment.Currency == Currency.NIO && payment.ExchangeRate is not null && payment.ExchangeRate <= 0)
            {
                return Bad("La tasa de cambio no es válida.", "payments");
            }

            if ((payment.Bank?.Length ?? 0) > 100 || (payment.Reference?.Length ?? 0) > 100)
            {
                return Bad("El banco y la referencia admiten hasta 100 caracteres.", "payments");
            }
        }

        return null;
    }

    private static ServiceError? ComputeDiscount(DiscountRequest? discount, decimal subtotal, out decimal discountNio)
    {
        discountNio = 0;
        if (discount is null)
        {
            return null;
        }

        if (discount.Value < 0)
        {
            return new ServiceError(ServiceErrorKind.Unprocessable, "discount_invalid", "El descuento no puede ser negativo.", "discount");
        }

        var value = Money.Round(discount.Value);
        if (value == 0)
        {
            return null;
        }

        switch (discount.Type)
        {
            case DiscountType.Percent:
                if (value > 100)
                {
                    return new ServiceError(ServiceErrorKind.Unprocessable, "discount_invalid", "Un descuento porcentual no puede pasar de 100%.", "discount");
                }

                discountNio = Money.Round(subtotal * value / 100);
                break;
            default:
                if (value > subtotal)
                {
                    return new ServiceError(ServiceErrorKind.Unprocessable, "discount_invalid", "El descuento no puede superar el subtotal.", "discount");
                }

                discountNio = value;
                break;
        }

        return null;
    }

    private static ServiceError? BuildPayments(
        SaleRequest request,
        Sale sale,
        decimal total,
        decimal currentRate,
        List<string> reviewNotes,
        out decimal paidNio,
        out decimal cashNio)
    {
        paidNio = 0;
        cashNio = 0;
        foreach (var payment in request.Payments!)
        {
            var amount = Money.Round(payment.Amount);
            var exchangeRate = payment.Currency == Currency.USD
                ? Money.RoundRate(payment.ExchangeRate!.Value)
                : (decimal?)null;
            var amountNio = payment.Currency == Currency.USD
                ? Money.Round(amount * exchangeRate!.Value)
                : amount;
            if (payment.Currency == Currency.USD && exchangeRate != currentRate)
            {
                if (!request.IsOffline)
                {
                    return new ServiceError(
                        ServiceErrorKind.Conflict,
                        "exchange_rate_changed",
                        $"La tasa vigente es C$ {currentRate:0.####} por dólar. Actualizá el punto de venta antes de cobrar.",
                        "payments");
                }

                reviewNotes.Add($"Tasa del dólar usada {exchangeRate:0.####}; la vigente es {currentRate:0.####}.");
            }

            paidNio += amountNio;
            if (payment.Method == PaymentMethod.Cash)
            {
                cashNio += amountNio;
            }

            sale.AddPayment(new SalePayment(
                Guid.NewGuid(),
                sale.Id,
                payment.Method,
                payment.Currency,
                amount,
                exchangeRate,
                amountNio,
                string.IsNullOrWhiteSpace(payment.Bank) ? null : payment.Bank.Trim(),
                string.IsNullOrWhiteSpace(payment.Reference) ? null : payment.Reference.Trim()));
        }

        paidNio = Money.Round(paidNio);
        if (paidNio < total)
        {
            return new ServiceError(
                ServiceErrorKind.Unprocessable,
                "payment_insufficient",
                $"Los pagos (C$ {paidNio:0.00}) no cubren el total (C$ {total:0.00}).",
                "payments");
        }

        return null;
    }

    /// <summary>
    /// Bloquea las filas de existencia de las variantes (en orden, para evitar bloqueos mutuos)
    /// de modo que dos cajas no descuenten a la vez la misma unidad.
    /// </summary>
    private async Task<Dictionary<Guid, StockBalance>> LockBalancesAsync(Guid[] variantIds, CancellationToken cancellationToken)
    {
        var balances = await dbContext.StockBalances
            .FromSqlInterpolated($"SELECT * FROM inventory.stock_balances WHERE \"VariantId\" = ANY({variantIds}) ORDER BY \"VariantId\" FOR UPDATE")
            .ToListAsync(cancellationToken);
        return balances.ToDictionary(balance => balance.VariantId);
    }

    private Task<CashSession?> LockCashSessionAsync(Guid id, CancellationToken cancellationToken) =>
        dbContext.CashSessions
            .FromSqlInterpolated($"SELECT * FROM sales.cash_sessions WHERE \"Id\" = {id} FOR UPDATE")
            .Include(candidate => candidate.Register)
            .SingleOrDefaultAsync(cancellationToken);

    private Task<DiscountApproval?> LockDiscountApprovalAsync(Guid id, CancellationToken cancellationToken) =>
        dbContext.DiscountApprovals
            .FromSqlInterpolated($"SELECT * FROM sales.discount_approvals WHERE \"Id\" = {id} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private Task<Sale?> LoadForUpdateAsync(Guid id, CancellationToken cancellationToken) =>
        dbContext.Sales
            .FromSqlInterpolated($"SELECT * FROM sales.sales WHERE \"Id\" = {id} FOR UPDATE")
            .Include(sale => sale.Lines)
            .Include(sale => sale.Payments)
            .Include(sale => sale.CashSession)
            .AsSplitQuery()
            .SingleOrDefaultAsync(cancellationToken);

    private async Task<Sale?> LoadAsync(Guid id, CancellationToken cancellationToken, bool track = false)
    {
        var query = dbContext.Sales.Include(sale => sale.Lines).Include(sale => sale.Payments).Include(sale => sale.CashSession).AsSplitQuery();
        if (!track)
        {
            query = query.AsNoTracking().AsSplitQuery();
        }

        return await query.SingleOrDefaultAsync(sale => sale.Id == id, cancellationToken);
    }

    private async Task<SaleDto?> FindByClientIdAsync(Guid clientSaleId, CancellationToken cancellationToken)
    {
        var sale = await dbContext.Sales.AsNoTracking()
            .Include(candidate => candidate.Lines).Include(candidate => candidate.Payments).Include(candidate => candidate.CashSession)
            .AsSplitQuery()
            .SingleOrDefaultAsync(candidate => candidate.ClientSaleId == clientSaleId, cancellationToken);
        return sale is null ? null : (await MapAsync([sale], cancellationToken))[0];
    }

    private async Task<IReadOnlyList<SaleDto>> MapAsync(IReadOnlyList<Sale> sales, CancellationToken cancellationToken)
    {
        var userIds = sales.Select(sale => sale.SellerUserId)
            .Concat(sales.Where(sale => sale.VoidedByUserId is not null).Select(sale => sale.VoidedByUserId!.Value))
            .Distinct().ToArray();
        var names = await dbContext.Users.AsNoTracking().Where(user => userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
        var registerIds = sales.Select(sale => sale.CashSession.RegisterId).Distinct().ToArray();
        var registers = await dbContext.CashRegisters.AsNoTracking().Where(register => registerIds.Contains(register.Id))
            .ToDictionaryAsync(register => register.Id, register => register.Name, cancellationToken);

        return sales.Select(sale => new SaleDto(
            sale.Id,
            InventoryNumber(sale.Number),
            sale.ClientSaleId,
            sale.Status,
            sale.Channel,
            sale.CashSessionId,
            registers[sale.CashSession.RegisterId],
            names[sale.SellerUserId],
            sale.CreatedAtUtc,
            sale.ReceivedAtUtc,
            sale.IsOffline,
            sale.SubtotalNio,
            sale.DiscountType,
            sale.DiscountValue,
            sale.DiscountNio,
            sale.TotalNio,
            sale.ChangeNio,
            sale.RequiresReview,
            sale.ReviewNote,
            sale.Note,
            sale.VoidedAtUtc,
            sale.VoidedByUserId is { } voider ? names[voider] : null,
            sale.VoidReason,
            sale.Lines.Select(line => new SaleLineDto(
                line.VariantId, line.ProductName, line.SizeName, line.ColorName, line.Barcode, line.Quantity, line.UnitPrice, line.LineTotalNio)).ToArray(),
            sale.Payments.Select(payment => new SalePaymentDto(
                payment.Method, payment.Currency, payment.Amount, payment.ExchangeRate, payment.AmountNio, payment.Bank, payment.Reference)).ToArray(),
            sale.CustomerName))
            .ToArray();
    }

    private static ServiceResult<SaleDto> NotFound() =>
        Result.Fail<SaleDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa venta.");

    private sealed record VariantInfo(
        Guid Id,
        string ProductName,
        string SizeName,
        string ColorName,
        string Barcode,
        decimal CurrentPrice,
        bool IsActive);
}

internal static class Money
{
    /// <summary>Redondeo a 2 decimales, mitad hacia arriba (igual que el frontend).</summary>
    public static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    public static decimal RoundRate(decimal value) => Math.Round(value, 4, MidpointRounding.AwayFromZero);
}
