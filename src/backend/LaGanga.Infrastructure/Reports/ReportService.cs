using System.Globalization;
using ClosedXML.Excel;
using LaGanga.Application.Common;
using LaGanga.Application.Investment;
using LaGanga.Application.Sales;
using LaGanga.Domain.Inventory;
using LaGanga.Domain.Sales;
using LaGanga.Infrastructure.Persistence;
using LaGanga.Infrastructure.Sales;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Reports;

public sealed class ReportService(
    LaGangaDbContext dbContext,
    ICashService cashService,
    IInvestmentService investmentService,
    TimeProvider timeProvider) : IReportService
{
    private const int MaxDays = 366;
    private const int MaxRows = 100_000;

    private static readonly string[] SalesHeaders =
    [
        "N.º de venta", "Fecha y hora", "Caja", "Vendedor/a", "Canal", "Subtotal C$", "Descuento C$", "Total C$",
        "Cambio C$", "Pagos", "Estado", "Hecha sin conexión", "Requiere revisión", "Nota de revisión", "Motivo de anulación",
    ];

    public async Task<ServiceResult<ReportFile>> SalesAsync(DateOnly fromDate, DateOnly toDate, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var range = ValidateRange(fromDate, toDate);
        if (range is not null)
        {
            return Result.Fail<ReportFile>(range);
        }

        var start = BusinessTime.DayRangeUtc(fromDate).StartUtc;
        var end = BusinessTime.DayRangeUtc(toDate).EndUtc;
        var sales = await dbContext.Sales.AsNoTracking()
            .Where(sale => sale.CreatedAtUtc >= start && sale.CreatedAtUtc < end)
            .OrderBy(sale => sale.CreatedAtUtc).ThenBy(sale => sale.Number)
            .Take(MaxRows + 1)
            .Include(sale => sale.Lines).Include(sale => sale.Payments).Include(sale => sale.CashSession)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        if (sales.Count > MaxRows)
        {
            return TooMany();
        }

        var userIds = sales.Select(sale => sale.SellerUserId).Concat(sales.Where(s => s.VoidedByUserId != null).Select(s => s.VoidedByUserId!.Value)).Distinct().ToArray();
        var users = await dbContext.Users.AsNoTracking().Where(user => userIds.Contains(user.Id)).ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
        var registers = await dbContext.CashRegisters.AsNoTracking().ToDictionaryAsync(register => register.Id, register => register.Name, cancellationToken);
        var totals = CashService.ComputeTotals(sales);

        using var workbook = new XLWorkbook();
        var summary = new XlsxSheet(workbook, "Resumen");
        summary.Title("Reporte de ventas", $"Del {Format(fromDate)} al {Format(toDate)} · hora de Managua · generado {GeneratedAt()}");
        summary.Widths(38, 20);
        summary.KeyValue("Ventas confirmadas", totals.SalesCount);
        summary.KeyValue("Ventas anuladas", totals.VoidedCount);
        summary.KeyValue("Monto de ventas anuladas C$", totals.VoidedTotalNio);
        summary.KeyValue("Ventas por revisar", totals.ReviewCount);
        summary.Blank();
        summary.KeyValue("Total bruto C$ (antes de descuentos)", totals.GrossTotalNio);
        summary.KeyValue("Descuentos C$", totals.DiscountTotalNio);
        summary.KeyValue("TOTAL VENDIDO C$", totals.NetTotalNio, bold: true);
        summary.Blank();
        summary.SectionTitle("Por método de pago (neto del cambio)");
        summary.KeyValue("Efectivo C$ (incluye dólares convertidos)", totals.CashTotalNio);
        summary.KeyValue("   Billetes en córdobas recibidos C$", totals.CashNioTendered);
        summary.KeyValue("   Dólares recibidos US$", totals.CashUsdTendered);
        summary.KeyValue("   Dólares convertidos a C$", totals.CashUsdEquivalentNio);
        summary.KeyValue("   Cambio entregado C$", totals.ChangeGivenNio);
        summary.KeyValue("Transferencia (equiv. C$)", totals.TransferTotalNio);
        summary.KeyValue("   Recibido en córdobas C$", totals.TransferNioTendered);
        summary.KeyValue("   Recibido en dólares US$", totals.TransferUsdTendered);
        summary.KeyValue("Tarjeta / POS (equiv. C$)", totals.CardTotalNio);
        summary.KeyValue("   Cobrado en córdobas C$", totals.CardNioTendered);
        summary.KeyValue("   Cobrado en dólares US$", totals.CardUsdTendered);
        summary.Blank();
        summary.SectionTitle("Por canal");
        foreach (var channel in totals.ByChannel)
        {
            summary.KeyValue($"{ChannelName(channel.Channel)} ({channel.SalesCount} ventas) C$", channel.TotalNio);
        }

        if (totals.TransfersByBank.Count > 0)
        {
            summary.Blank();
            summary.SectionTitle("Transferencias por banco");
            foreach (var bank in totals.TransfersByBank)
            {
                summary.KeyValue($"{bank.Bank} C$", bank.TotalNio);
            }
        }

        var salesSheet = new XlsxSheet(workbook, "Ventas");
        salesSheet.Header(SalesHeaders, [12, 17, 10, 20, 11, 13, 13, 13, 11, 34, 12, 12, 12, 40, 34]);
        var first = salesSheet.NextRow;
        foreach (var sale in sales)
        {
            salesSheet.Row(
                Number(sale.Number),
                Local(sale.CreatedAtUtc),
                registers[sale.CashSession.RegisterId],
                users[sale.SellerUserId],
                ChannelName(sale.Channel),
                sale.SubtotalNio,
                sale.DiscountNio,
                sale.TotalNio,
                sale.ChangeNio,
                string.Join(" + ", sale.Payments.Select(PaymentText)),
                sale.Status == SaleStatus.Voided ? "Anulada" : "Confirmada",
                sale.IsOffline,
                sale.RequiresReview,
                sale.ReviewNote,
                sale.VoidReason);
        }

        salesSheet.FinishTable(first);

        var detail = new XlsxSheet(workbook, "Detalle");
        detail.Header(["N.º de venta", "Fecha y hora", "Estado", "Producto", "Talla", "Color", "Código de barras", "Cantidad", "Precio C$", "Total línea C$"], [12, 17, 12, 38, 8, 14, 18, 10, 12, 14]);
        first = detail.NextRow;
        foreach (var sale in sales)
        {
            foreach (var line in sale.Lines)
            {
                detail.Row(Number(sale.Number), Local(sale.CreatedAtUtc), sale.Status == SaleStatus.Voided ? "Anulada" : "Confirmada", line.ProductName, line.SizeName, line.ColorName, line.Barcode, line.Quantity, line.UnitPrice, line.LineTotalNio);
            }
        }

        detail.FinishTable(first);

        var payments = new XlsxSheet(workbook, "Pagos");
        payments.Header(["N.º de venta", "Fecha y hora", "Estado", "Método", "Moneda", "Monto recibido", "Tasa", "Equivalente C$", "Banco", "Referencia"], [12, 17, 12, 16, 9, 15, 9, 15, 16, 22]);
        first = payments.NextRow;
        foreach (var sale in sales)
        {
            foreach (var payment in sale.Payments)
            {
                payments.Row(Number(sale.Number), Local(sale.CreatedAtUtc), sale.Status == SaleStatus.Voided ? "Anulada" : "Confirmada", MethodName(payment.Method), payment.Currency.ToString(), payment.Amount, payment.ExchangeRate, payment.AmountNio, payment.Bank, payment.Reference);
            }
        }

        payments.FinishTable(first);
        return Result.Ok(Save(workbook, $"ventas_{Iso(fromDate)}_a_{Iso(toDate)}.xlsx"));
    }

    public async Task<ServiceResult<ReportFile>> InventoryAsync(Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var threshold = await dbContext.Settings.AsNoTracking().Select(settings => settings.LowStockThreshold).SingleAsync(cancellationToken);
        var rows = await (
            from variant in dbContext.Variants.AsNoTracking()
            join product in dbContext.Products on variant.ProductId equals product.Id
            join category in dbContext.Categories on product.CategoryId equals category.Id
            join brand in dbContext.Brands on product.BrandId equals brand.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            join balance in dbContext.StockBalances on variant.Id equals balance.VariantId into balances
            from balance in balances.DefaultIfEmpty()
            orderby product.Name, size.SortOrder, color.Name
            select new
            {
                Product = product.Name,
                Category = category.Name,
                Brand = brand.Name,
                Size = size.Name,
                Color = color.Name,
                variant.Barcode,
                Price = variant.PriceOverride ?? product.BasePrice,
                variant.Cost,
                Stock = balance == null ? 0 : balance.Quantity,
                Active = variant.IsActive && product.IsActive,
            })
            .Take(MaxRows + 1)
            .ToListAsync(cancellationToken);
        if (rows.Count > MaxRows)
        {
            return TooMany();
        }

        var includeCost = actor.CanSeeCosts;
        using var workbook = new XLWorkbook();
        var summary = new XlsxSheet(workbook, "Resumen");
        summary.Title("Existencias actuales", $"Corte al {GeneratedAt()} · hora de Managua");
        summary.Widths(40, 20);
        summary.KeyValue("Variantes (talla/color)", rows.Count);
        summary.KeyValue("Unidades en existencia", rows.Where(row => row.Stock > 0).Sum(row => row.Stock));
        summary.KeyValue("Valor a precio de venta C$", rows.Where(row => row.Stock > 0).Sum(row => row.Price * row.Stock));
        if (includeCost)
        {
            summary.KeyValue("Valor al costo C$ (solo variantes con costo)", rows.Where(row => row.Stock > 0 && row.Cost != null).Sum(row => row.Cost!.Value * row.Stock));
            summary.KeyValue("Variantes con existencia y sin costo", rows.Count(row => row.Stock > 0 && row.Cost == null));
        }

        summary.Blank();
        summary.KeyValue($"Con stock bajo (1 a {threshold} unidades)", rows.Count(row => row.Stock > 0 && row.Stock <= threshold));
        summary.KeyValue("Agotadas", rows.Count(row => row.Stock == 0));
        summary.KeyValue("Con saldo negativo (revisar)", rows.Count(row => row.Stock < 0));

        var sheet = new XlsxSheet(workbook, "Existencias");
        var headers = new List<string> { "Producto", "Categoría", "Marca", "Talla", "Color", "Código de barras", "Precio C$", "Existencia", "Estado" };
        var widths = new List<double> { 38, 14, 16, 8, 14, 18, 12, 11, 14 };
        if (includeCost)
        {
            headers.AddRange(["Costo C$", "Valor al costo C$"]);
            widths.AddRange([12, 16]);
        }

        sheet.Header([.. headers], [.. widths]);
        var first = sheet.NextRow;
        foreach (var row in rows)
        {
            var state = row.Stock < 0 ? "Negativo" : row.Stock == 0 ? "Agotado" : row.Stock <= threshold ? "Stock bajo" : row.Active ? "Disponible" : "Inactivo";
            if (includeCost)
            {
                sheet.Row(row.Product, row.Category, row.Brand, row.Size, row.Color, row.Barcode, row.Price, row.Stock, state, row.Cost, row.Cost is { } cost ? cost * row.Stock : null);
            }
            else
            {
                sheet.Row(row.Product, row.Category, row.Brand, row.Size, row.Color, row.Barcode, row.Price, row.Stock, state);
            }
        }

        sheet.FinishTable(first);
        return Result.Ok(Save(workbook, $"existencias_{Iso(BusinessTime.ToBusinessDate(timeProvider.GetUtcNow()))}.xlsx"));
    }

    public async Task<ServiceResult<ReportFile>> MovementsAsync(DateOnly fromDate, DateOnly toDate, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var range = ValidateRange(fromDate, toDate);
        if (range is not null)
        {
            return Result.Fail<ReportFile>(range);
        }

        var start = BusinessTime.DayRangeUtc(fromDate).StartUtc;
        var end = BusinessTime.DayRangeUtc(toDate).EndUtc;
        var rows = await (
            from movement in dbContext.Movements.AsNoTracking().Where(m => m.CreatedAtUtc >= start && m.CreatedAtUtc < end)
            join variant in dbContext.Variants on movement.VariantId equals variant.Id
            join product in dbContext.Products on variant.ProductId equals product.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            join user in dbContext.Users on movement.UserId equals user.Id into users
            from user in users.DefaultIfEmpty()
            join sale in dbContext.Sales on movement.SaleId equals sale.Id into sales
            from sale in sales.DefaultIfEmpty()
            orderby movement.CreatedAtUtc, movement.Id
            select new
            {
                movement.CreatedAtUtc,
                movement.Type,
                Product = product.Name,
                Size = size.Name,
                Color = color.Name,
                variant.Barcode,
                movement.Quantity,
                movement.BalanceAfter,
                movement.Reason,
                SaleNumber = sale == null ? (long?)null : sale.Number,
                UserName = user == null ? "Sistema" : user.DisplayName,
            })
            .Take(MaxRows + 1)
            .ToListAsync(cancellationToken);
        if (rows.Count > MaxRows)
        {
            return TooMany();
        }

        using var workbook = new XLWorkbook();
        var sheet = new XlsxSheet(workbook, "Movimientos");
        sheet.Title("Movimientos de inventario (Kardex)", $"Del {Format(fromDate)} al {Format(toDate)} · hora de Managua · generado {GeneratedAt()}");
        sheet.Header(["Fecha y hora", "Tipo", "Producto", "Talla", "Color", "Código de barras", "Cantidad", "Saldo después", "Motivo", "N.º de venta", "Usuario"], [17, 18, 38, 8, 14, 18, 10, 13, 40, 12, 20], freeze: true);
        var first = sheet.NextRow;
        foreach (var row in rows)
        {
            sheet.Row(Local(row.CreatedAtUtc), MovementName(row.Type), row.Product, row.Size, row.Color, row.Barcode, row.Quantity, row.BalanceAfter, row.Reason, row.SaleNumber is { } number ? Number(number) : null, row.UserName);
        }

        sheet.FinishTable(first);
        return Result.Ok(Save(workbook, $"movimientos_{Iso(fromDate)}_a_{Iso(toDate)}.xlsx"));
    }

    public async Task<ServiceResult<ReportFile>> CashAsync(DateOnly fromDate, DateOnly toDate, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var range = ValidateRange(fromDate, toDate);
        if (range is not null)
        {
            return Result.Fail<ReportFile>(range);
        }

        var summaries = (await cashService.ListSessionsAsync(fromDate, toDate, cancellationToken))
            .OrderBy(summary => summary.Session.OpenedAtUtc).ToArray();

        using var workbook = new XLWorkbook();
        var sessions = new XlsxSheet(workbook, "Cierres por caja");
        sessions.Title("Cierres de caja", $"Del {Format(fromDate)} al {Format(toDate)} · por fecha de apertura · hora de Managua · generado {GeneratedAt()}");
        sessions.Header(
        [
            "Fecha", "Caja", "Cajero/a", "Apertura", "Cierre", "Estado", "Fondo C$", "Fondo US$", "Ventas", "Anuladas",
            "Bruto C$", "Descuentos C$", "TOTAL VENDIDO C$", "Efectivo neto C$", "Transferencia (equiv. C$)", "Tarjeta / POS (equiv. C$)",
            "EFECTIVO esperado C$", "Efectivo contado C$", "Efectivo diferencia C$", "EFECTIVO esperado US$", "Efectivo contado US$", "Efectivo diferencia US$",
            "TRANSFERENCIA esperada C$", "Transferencia verificada C$", "Transferencia diferencia C$", "TRANSFERENCIA esperada US$", "Transferencia verificada US$", "Transferencia diferencia US$",
            "TARJETA esperada C$", "Tarjeta terminal C$", "Tarjeta diferencia C$", "TARJETA esperada US$", "Tarjeta terminal US$", "Tarjeta diferencia US$",
            "Notas",
        ],
        [11, 9, 20, 17, 17, 10, 11, 11, 8, 9, 13, 13, 17, 15, 17, 17, 15, 14, 14, 14, 14, 14, 16, 16, 16, 16, 16, 16, 14, 14, 14, 14, 14, 14, 32]);
        var first = sessions.NextRow;
        foreach (var summary in summaries)
        {
            var session = summary.Session;
            var totals = summary.Totals;
            sessions.Row(
                BusinessTime.ToBusinessDate(session.OpenedAtUtc), session.RegisterName, session.OpenedByName, Local(session.OpenedAtUtc),
                session.ClosedAtUtc is { } closed ? Local(closed) : null, session.ClosedAtUtc is null ? "Abierta" : "Cerrada",
                session.OpeningFloatNio, session.OpeningFloatUsd, totals.SalesCount, totals.VoidedCount,
                totals.GrossTotalNio, totals.DiscountTotalNio, totals.NetTotalNio, totals.CashTotalNio, totals.TransferTotalNio, totals.CardTotalNio,
                summary.ExpectedCashNio, session.CountedCashNio, summary.DifferenceCashNio,
                summary.ExpectedCashUsd, session.CountedCashUsd, summary.DifferenceCashUsd,
                summary.ExpectedTransferNio, session.CountedTransferNio, summary.DifferenceTransferNio,
                summary.ExpectedTransferUsd, session.CountedTransferUsd, summary.DifferenceTransferUsd,
                summary.ExpectedCardNio, session.CountedCardNio, summary.DifferenceCardNio,
                summary.ExpectedCardUsd, session.CountedCardUsd, summary.DifferenceCardUsd,
                session.ClosingNotes);
        }

        sessions.FinishTable(first);

        var days = new XlsxSheet(workbook, "Consolidado por día");
        days.Title("Consolidado por día (todas las cajas)", "Esperado = lo que el sistema registró. Contado/verificado = lo que se contó en caja, se verificó en el banco o marcó la terminal al cerrar.");
        days.Header(
        [
            "Fecha", "Cajas", "Ventas", "Anuladas", "Descuentos C$", "TOTAL VENDIDO C$", "Efectivo neto C$", "Transferencia (equiv. C$)", "Tarjeta / POS (equiv. C$)",
            "EFECTIVO esperado C$", "Efectivo contado C$", "Efectivo diferencia C$", "EFECTIVO esperado US$", "Efectivo contado US$", "Efectivo diferencia US$",
            "TRANSFERENCIA esperada C$", "Transferencia verificada C$", "TRANSFERENCIA esperada US$", "Transferencia verificada US$",
            "TARJETA esperada C$", "Tarjeta terminal C$", "TARJETA esperada US$", "Tarjeta terminal US$", "Cajas abiertas",
        ],
        [11, 8, 8, 9, 13, 17, 15, 17, 17, 15, 14, 14, 14, 14, 14, 16, 16, 16, 16, 14, 14, 14, 14, 13], freeze: false);
        first = days.NextRow;
        foreach (var day in summaries.GroupBy(summary => BusinessTime.ToBusinessDate(summary.Session.OpenedAtUtc)).OrderBy(group => group.Key))
        {
            var open = day.Count(summary => summary.Session.ClosedAtUtc is null);
            var expectedNio = day.Sum(summary => summary.ExpectedCashNio);
            var expectedUsd = day.Sum(summary => summary.ExpectedCashUsd);
            decimal? countedNio = open > 0 ? null : day.Sum(summary => summary.Session.CountedCashNio ?? 0);
            decimal? countedUsd = open > 0 ? null : day.Sum(summary => summary.Session.CountedCashUsd ?? 0);
            decimal? Verified(Func<CashSummaryDto, decimal?> selector) =>
                open > 0 || day.Any(summary => selector(summary) is null) ? null : day.Sum(summary => selector(summary)!.Value);
            days.Row(
                day.Key, day.Count(), day.Sum(s => s.Totals.SalesCount), day.Sum(s => s.Totals.VoidedCount), day.Sum(s => s.Totals.DiscountTotalNio),
                day.Sum(s => s.Totals.NetTotalNio), day.Sum(s => s.Totals.CashTotalNio), day.Sum(s => s.Totals.TransferTotalNio), day.Sum(s => s.Totals.CardTotalNio),
                expectedNio, countedNio, countedNio - expectedNio, expectedUsd, countedUsd, countedUsd - expectedUsd,
                day.Sum(s => s.ExpectedTransferNio), Verified(s => s.Session.CountedTransferNio),
                day.Sum(s => s.ExpectedTransferUsd), Verified(s => s.Session.CountedTransferUsd),
                day.Sum(s => s.ExpectedCardNio), Verified(s => s.Session.CountedCardNio),
                day.Sum(s => s.ExpectedCardUsd), Verified(s => s.Session.CountedCardUsd),
                open);
        }

        days.FinishTable(first);

        var banks = new XlsxSheet(workbook, "Transferencias por banco");
        banks.Title("Transferencias por banco", $"Del {Format(fromDate)} al {Format(toDate)}");
        banks.Header(["Banco", "Total (equiv. C$)", "De ese total, recibido en US$"], [28, 18, 24], freeze: false);
        foreach (var bank in summaries.SelectMany(summary => summary.Totals.TransfersByBank)
                     .GroupBy(bank => bank.Bank, StringComparer.OrdinalIgnoreCase)
                     .Select(group => new BankTotalDto(group.Key, group.Sum(bank => bank.TotalNio), group.Sum(bank => bank.TotalUsd)))
                     .OrderByDescending(bank => bank.TotalNio))
        {
            banks.Row(bank.Bank, bank.TotalNio, bank.TotalUsd);
        }

        return Result.Ok(Save(workbook, $"cierres_de_caja_{Iso(fromDate)}_a_{Iso(toDate)}.xlsx"));
    }

    public async Task<ServiceResult<ReportFile>> InvestmentAsync(DateOnly fromDate, DateOnly toDate, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var range = ValidateRange(fromDate, toDate);
        if (range is not null)
        {
            return Result.Fail<ReportFile>(range);
        }

        var summary = await investmentService.GetSummaryAsync(fromDate, toDate, cancellationToken);
        var breakdown = await investmentService.GetBreakdownAsync(null, fromDate, toDate, cancellationToken);
        var lots = new List<LotDto>();
        for (var page = 1; ; page++)
        {
            var batch = await investmentService.ListLotsAsync(new LotQuery(null, null, false, fromDate, toDate, page, Paging.MaxPageSize), cancellationToken);
            lots.AddRange(batch.Items);
            if (page >= batch.TotalPages || lots.Count >= MaxRows)
            {
                break;
            }
        }

        using var workbook = new XLWorkbook();
        var sheet = new XlsxSheet(workbook, "Resumen por socio");
        sheet.Title("Socios e inversión", $"Entradas y ventas del {Format(fromDate)} al {Format(toDate)} · las existencias son las de hoy · generado {GeneratedAt()}");
        sheet.Header(
        [
            "Socio", "Unidades ingresadas", "Inversión C$ (costo × unidades)", "Unidades sin costo", "Existencias (unid.)", "Existencias al costo C$", "Existencias a precio de venta C$",
            "Unidades vendidas", "Vendido C$ (con descuentos)", "Costo de lo vendido C$", "GANANCIA C$", "Vendidas sin costo (ganancia parcial)", "Pérdidas (unid.)", "Costo de pérdidas C$",
        ],
        [26, 12, 18, 11, 12, 16, 18, 11, 17, 16, 15, 16, 11, 15], freeze: false);
        var first = sheet.NextRow;
        foreach (var row in summary.Partners.Append(summary.Totals))
        {
            sheet.Row(
                row.PartnerName, row.UnitsEntered, row.InvestedNio, row.UnitsWithoutCost, row.UnitsInStock, row.StockAtCostNio, row.StockAtPriceNio,
                row.UnitsSold, row.RevenueNio, row.CostOfSoldNio, row.ProfitNio, row.SoldUnitsWithoutCost, row.LossUnits, row.LossCostNio);
        }

        sheet.FinishTable(first);

        var products = new XlsxSheet(workbook, "Por producto");
        products.Header(["Socio", "Producto", "Unidades ingresadas", "Inversión C$", "Existencias (unid.)", "Existencias al costo C$", "Unidades vendidas", "Vendido C$", "Ganancia C$"], [26, 38, 12, 14, 12, 16, 11, 14, 14]);
        first = products.NextRow;
        foreach (var row in breakdown)
        {
            products.Row(row.PartnerName, row.ProductName, row.UnitsEntered, row.InvestedNio, row.UnitsInStock, row.StockAtCostNio, row.UnitsSold, row.RevenueNio, row.ProfitNio);
        }

        products.FinishTable(first);

        var entries = new XlsxSheet(workbook, "Entradas");
        entries.Header(
            ["Fecha", "Socio", "Producto", "Talla", "Color", "Código de barras", "Origen", "Ingresó", "Cantidad ingresada", "Quedan", "Vendidas", "Pérdidas", "Costo unitario C$", "Precio dado C$", "Precio actual C$", "Inversión C$", "Nota"],
            [17, 22, 36, 8, 14, 18, 14, 20, 11, 9, 10, 10, 13, 13, 13, 14, 30]);
        first = entries.NextRow;
        foreach (var lot in lots.OrderBy(lot => lot.EnteredAtUtc))
        {
            entries.Row(
                Local(lot.EnteredAtUtc), lot.PartnerName, lot.ProductName, lot.SizeName, lot.ColorName, lot.Barcode, SourceName(lot.Source), lot.EnteredByName,
                lot.QuantityIn, lot.QuantityRemaining, lot.QuantitySold, lot.QuantityLost, lot.UnitCost, lot.UnitPrice, lot.CurrentPrice, lot.InvestedNio, lot.Note);
        }

        entries.FinishTable(first);
        return Result.Ok(Save(workbook, $"socios_e_inversion_{Iso(fromDate)}_a_{Iso(toDate)}.xlsx"));
    }

    private static string SourceName(string source) => source switch
    {
        "InitialStock" => "Existencia inicial",
        "Entry" => "Entrada",
        "Adjustment" => "Ajuste",
        "Import" => "Importación",
        "Opening" => "Saldo inicial",
        _ => "Unidades sin entrada",
    };

    private static ServiceError? ValidateRange(DateOnly fromDate, DateOnly toDate)
    {
        if (toDate < fromDate)
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "La fecha final no puede ser anterior a la inicial.", "to");
        }

        if (toDate.DayNumber - fromDate.DayNumber + 1 > MaxDays)
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", $"El rango no puede pasar de {MaxDays} días.", "to");
        }

        return null;
    }

    private static ServiceResult<ReportFile> TooMany() =>
        Result.Fail<ReportFile>(ServiceErrorKind.Validation, "validation_failed", $"El reporte tiene más de {MaxRows:N0} filas. Elegí un rango de fechas más corto.");

    private static ReportFile Save(XLWorkbook workbook, string fileName)
    {
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return new ReportFile(fileName, stream.ToArray());
    }

    private string GeneratedAt() =>
        timeProvider.GetUtcNow().ToOffset(BusinessTime.ManaguaOffset).ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);

    private static DateTime Local(DateTimeOffset moment) => moment.ToOffset(BusinessTime.ManaguaOffset).DateTime;

    private static string Number(long number) => string.Create(CultureInfo.InvariantCulture, $"V-{number:D6}");

    private static string Format(DateOnly date) => date.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    private static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string ChannelName(SaleChannel channel) => channel switch
    {
        SaleChannel.Store => "Tienda",
        SaleChannel.WhatsApp => "WhatsApp",
        _ => "Facebook",
    };

    private static string MethodName(PaymentMethod method) => method switch
    {
        PaymentMethod.Cash => "Efectivo",
        PaymentMethod.Transfer => "Transferencia",
        _ => "Tarjeta (POS)",
    };

    private static string PaymentText(SalePayment payment) =>
        payment.Currency == Currency.USD
            ? string.Create(CultureInfo.InvariantCulture, $"{MethodName(payment.Method)} US$ {payment.Amount:0.00}")
            : string.Create(CultureInfo.InvariantCulture, $"{MethodName(payment.Method)}{(string.IsNullOrWhiteSpace(payment.Bank) ? string.Empty : $" {payment.Bank}")} C$ {payment.Amount:0.00}");

    private static string MovementName(MovementType type) => type switch
    {
        MovementType.InitialStock => "Existencia inicial",
        MovementType.Entry => "Entrada",
        MovementType.Adjustment => "Ajuste",
        MovementType.Loss => "Pérdida",
        MovementType.Sale => "Venta",
        _ => "Anulación de venta",
    };
}
