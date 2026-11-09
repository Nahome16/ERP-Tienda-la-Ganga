using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace LaGanga.Api.Tests;

/// <summary>Recorridos completos del MVP: inventario, cajas, ventas, pagos, descuentos y cierres.</summary>
public sealed class MvpApiTests(CatalogApiFixture fixture) : IClassFixture<CatalogApiFixture>
{
    private static int _counter;

    private sealed record Seller(HttpClient Client, string Csrf, string Username);

    private sealed record Catalogs(Guid Category, Guid Brand, Guid[] Sizes, Guid[] Colors);

    [PostgresFact]
    public async Task FullSaleFlowKeepsStockPaymentsAndClosingConsistent()
    {
        var catalogs = await LoadCatalogsAsync();
        var product = await CreateProductAsync(catalogs, "Jeans flujo completo", 1000m, [(10, 400m), (3, 400m)]);
        var variant1 = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        var variant2 = product.GetProperty("variants")[1].GetProperty("id").GetGuid();
        var seller = await CreateSellerAsync();

        var session = await OpenCashAsync(seller, 500m, 20m);
        var snapshot = await GetAsync(seller.Client, "/api/v1/pos/snapshot");
        var snapshotVariant = snapshot.GetProperty("variants").EnumerateArray().Single(v => v.GetProperty("variantId").GetGuid() == variant1);
        Assert.Equal(10, snapshotVariant.GetProperty("stock").GetInt32());
        Assert.False(snapshotVariant.TryGetProperty("cost", out _));

        var sale1Id = Guid.NewGuid();
        var sale1 = await PostSaleAsync(seller, session, sale1Id, [(variant1, 2, 1000m)], new { type = "Percent", value = 10m }, null,
            [Pay("Cash", "USD", 20m, 36.7m), Pay("Cash", "NIO", 1100m)]);
        Assert.False(sale1.GetProperty("alreadyProcessed").GetBoolean());
        var s1 = sale1.GetProperty("sale");
        Assert.Equal(2000m, s1.GetProperty("subtotalNio").GetDecimal());
        Assert.Equal(200m, s1.GetProperty("discountNio").GetDecimal());
        Assert.Equal(1800m, s1.GetProperty("totalNio").GetDecimal());
        Assert.Equal(34m, s1.GetProperty("changeNio").GetDecimal());
        Assert.False(s1.GetProperty("requiresReview").GetBoolean());
        Assert.StartsWith("V-", s1.GetProperty("number").GetString(), StringComparison.Ordinal);

        _ = await PostSaleAsync(seller, session, Guid.NewGuid(), [(variant2, 1, 1000m)], null, null,
            [Pay("Transfer", "NIO", 600m, bank: "BAC"), Pay("Card", "NIO", 400m)]);

        // Reenviar la misma venta no duplica nada.
        var resend = await PostSaleAsync(seller, session, sale1Id, [(variant1, 2, 1000m)], new { type = "Percent", value = 10m }, null,
            [Pay("Cash", "USD", 20m, 36.7m), Pay("Cash", "NIO", 1100m)], expected: HttpStatusCode.OK);
        Assert.True(resend.GetProperty("alreadyProcessed").GetBoolean());
        Assert.Equal(s1.GetProperty("number").GetString(), resend.GetProperty("sale").GetProperty("number").GetString());

        var detail = await GetAsync(fixture.Admin, $"/api/v1/products/{product.GetProperty("id").GetGuid()}");
        Assert.Equal(8, detail.GetProperty("variants")[0].GetProperty("stock").GetInt32());
        Assert.Equal(2, detail.GetProperty("variants")[1].GetProperty("stock").GetInt32());

        var summary = await GetAsync(seller.Client, $"/api/v1/cash/sessions/{session}/summary");
        var totals = summary.GetProperty("totals");
        Assert.Equal(2, totals.GetProperty("salesCount").GetInt32());
        Assert.Equal(3000m, totals.GetProperty("grossTotalNio").GetDecimal());
        Assert.Equal(200m, totals.GetProperty("discountTotalNio").GetDecimal());
        Assert.Equal(2800m, totals.GetProperty("netTotalNio").GetDecimal());
        Assert.Equal(1100m, totals.GetProperty("cashNioTendered").GetDecimal());
        Assert.Equal(20m, totals.GetProperty("cashUsdTendered").GetDecimal());
        Assert.Equal(734m, totals.GetProperty("cashUsdEquivalentNio").GetDecimal());
        Assert.Equal(34m, totals.GetProperty("changeGivenNio").GetDecimal());
        Assert.Equal(1800m, totals.GetProperty("cashTotalNio").GetDecimal());
        Assert.Equal(600m, totals.GetProperty("transferTotalNio").GetDecimal());
        Assert.Equal(400m, totals.GetProperty("cardTotalNio").GetDecimal());
        Assert.Equal(
            totals.GetProperty("netTotalNio").GetDecimal(),
            totals.GetProperty("cashTotalNio").GetDecimal() + totals.GetProperty("transferTotalNio").GetDecimal() + totals.GetProperty("cardTotalNio").GetDecimal());
        Assert.Equal(1566m, summary.GetProperty("expectedCashNio").GetDecimal());
        Assert.Equal(40m, summary.GetProperty("expectedCashUsd").GetDecimal());
        Assert.Equal("BAC", totals.GetProperty("transfersByBank")[0].GetProperty("bank").GetString());

        var closed = await PostAsync(seller.Client, seller.Csrf, $"/api/v1/cash/sessions/{session}/close",
            new { countedCashNio = 1560m, countedCashUsd = 40m, notes = "Faltan 6 córdobas" });
        Assert.Equal(-6m, closed.GetProperty("differenceCashNio").GetDecimal());
        Assert.Equal(0m, closed.GetProperty("differenceCashUsd").GetDecimal());

        // Un cierre emitido es histórico: una anulación posterior no puede reescribirlo.
        var voidAfterClose = await PostRawAsync(
            fixture.Admin,
            fixture.AdminCsrf,
            $"/api/v1/sales/{s1.GetProperty("id").GetGuid()}/void",
            new { reason = "Solicitud posterior al cierre" });
        Assert.Equal(HttpStatusCode.Conflict, voidAfterClose.StatusCode);
        Assert.Equal("cash_session_closed", await ApiTestHelpers.ReadProblemCodeAsync(voidAfterClose));

        var lateOnline = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variant1, 1, 1000m)], null, null, [Pay("Card", "NIO", 1000m)]);
        Assert.Equal(HttpStatusCode.Conflict, lateOnline.StatusCode);
        Assert.Equal("session_closed", await ApiTestHelpers.ReadProblemCodeAsync(lateOnline));

        var lateOffline = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variant1, 1, 1000m)], null, null,
            [Pay("Card", "NIO", 1000m)], isOffline: true);
        Assert.Equal(HttpStatusCode.Created, lateOffline.StatusCode); // ocurrió sin red: se conserva y queda para conciliación
        Assert.True((await ReadAsync(lateOffline)).GetProperty("sale").GetProperty("requiresReview").GetBoolean());

        var immutableClose = await GetAsync(seller.Client, $"/api/v1/cash/sessions/{session}/summary");
        Assert.Equal(2, immutableClose.GetProperty("totals").GetProperty("salesCount").GetInt32());
        Assert.Equal(2800m, immutableClose.GetProperty("totals").GetProperty("netTotalNio").GetDecimal());
        Assert.Equal(-6m, immutableClose.GetProperty("differenceCashNio").GetDecimal());

        var consolidated = await GetAsync(fixture.Admin, "/api/v1/cash/consolidated");
        Assert.True(consolidated.GetProperty("totals").GetProperty("netTotalNio").GetDecimal() >= 2800m);
        var forbidden = await seller.Client.GetAsync(new Uri("/api/v1/cash/consolidated", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }

    [PostgresFact]
    public async Task SellingMoreThanTheStockIsRejectedOnlineAndFlaggedOffline()
    {
        var catalogs = await LoadCatalogsAsync();
        var product = await CreateProductAsync(catalogs, "Camisa sin stock", 500m, [(1, null), (0, null)]);
        var withStock = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        var withoutStock = product.GetProperty("variants")[1].GetProperty("id").GetGuid();
        var seller = await CreateSellerAsync();
        var session = await OpenCashAsync(seller, 0m, 0m);

        // Con conexión: más de lo que hay → rechazada, y no se toca el inventario.
        var tooMany = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(withStock, 3, 500m)], null, null, [Pay("Cash", "NIO", 1500m)]);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, tooMany.StatusCode);
        Assert.Equal("insufficient_stock", await ApiTestHelpers.ReadProblemCodeAsync(tooMany));
        var empty = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(withoutStock, 1, 500m)], null, null, [Pay("Cash", "NIO", 500m)]);
        Assert.Equal("insufficient_stock", await ApiTestHelpers.ReadProblemCodeAsync(empty));
        var intact = await GetAsync(fixture.Admin, $"/api/v1/products/{product.GetProperty("id").GetGuid()}");
        Assert.Equal(1, intact.GetProperty("variants")[0].GetProperty("stock").GetInt32());
        Assert.Equal(0, intact.GetProperty("variants")[1].GetProperty("stock").GetInt32());

        // Una venta que sí alcanza se acepta.
        var enough = await PostSaleAsync(seller, session, Guid.NewGuid(), [(withStock, 1, 500m)], null, null, [Pay("Cash", "NIO", 500m)]);
        Assert.False(enough.GetProperty("sale").GetProperty("requiresReview").GetBoolean());

        // Sin conexión no se puede rechazar (la prenda ya salió): se acepta y queda para revisión.
        var offline = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(withStock, 2, 500m)], null, null, [Pay("Cash", "NIO", 1000m)], isOffline: true);
        Assert.Equal(HttpStatusCode.Created, offline.StatusCode);
        var sale = (await ReadAsync(offline)).GetProperty("sale");
        Assert.True(sale.GetProperty("requiresReview").GetBoolean());
        Assert.Contains("Stock insuficiente", sale.GetProperty("reviewNote").GetString(), StringComparison.Ordinal);
        var negative = await GetAsync(fixture.Admin, "/api/v1/inventory?filter=negative&pageSize=100");
        Assert.Contains(negative.GetProperty("items").EnumerateArray(), item => item.GetProperty("variantId").GetGuid() == withStock && item.GetProperty("stock").GetInt32() == -2);

        // Anular devuelve las unidades.
        var saleId = sale.GetProperty("id").GetGuid();
        var voided = await PostAsync(fixture.Admin, fixture.AdminCsrf, $"/api/v1/sales/{saleId}/void", new { reason = "Error al cobrar" });
        Assert.Equal("Voided", voided.GetProperty("status").GetString());
        var detail = await GetAsync(fixture.Admin, $"/api/v1/products/{product.GetProperty("id").GetGuid()}");
        Assert.Equal(0, detail.GetProperty("variants")[0].GetProperty("stock").GetInt32());

        var again = await PostRawAsync(fixture.Admin, fixture.AdminCsrf, $"/api/v1/sales/{saleId}/void", new { reason = "Otra vez" });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        var kardex = await GetAsync(fixture.Admin, $"/api/v1/inventory/variants/{withStock}/kardex");
        var types = kardex.GetProperty("items").EnumerateArray().Select(row => row.GetProperty("type").GetString()).ToArray();
        Assert.Contains("SaleVoid", types);
        Assert.Contains("Sale", types);
        Assert.Contains("InitialStock", types);

        _ = await PostAsync(seller.Client, seller.Csrf, $"/api/v1/cash/sessions/{session}/close", new { countedCashNio = 500m, countedCashUsd = 0m });
    }

    [PostgresFact]
    public async Task DiscountsOverTheLimitNeedAnAdministratorApproval()
    {
        var catalogs = await LoadCatalogsAsync();
        var product = await CreateProductAsync(catalogs, "Vestido descuento", 1000m, [(20, null)]);
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        var seller = await CreateSellerAsync();
        var session = await OpenCashAsync(seller, 0m, 0m);
        var discount = new { type = "Percent", value = 25m };

        var denied = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], discount, null, [Pay("Cash", "NIO", 750m)]);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, denied.StatusCode);
        Assert.Equal("discount_not_authorized", await ApiTestHelpers.ReadProblemCodeAsync(denied));

        var wrong = await PostRawAsync(seller.Client, seller.Csrf, "/api/v1/pos/discount-approvals", new { username = CatalogApiFixture.AdminUsername, password = "incorrecta-123456" });
        Assert.Equal("invalid_credentials", await ApiTestHelpers.ReadProblemCodeAsync(wrong));
        var notAllowed = await PostRawAsync(seller.Client, seller.Csrf, "/api/v1/pos/discount-approvals", new { username = seller.Username, password = CatalogApiFixture.DefaultPassword });
        Assert.Equal(HttpStatusCode.Forbidden, notAllowed.StatusCode);

        var approval = await PostAsync(seller.Client, seller.Csrf, "/api/v1/pos/discount-approvals", new { username = CatalogApiFixture.AdminUsername, password = CatalogApiFixture.DefaultPassword });
        var approvalId = approval.GetProperty("approvalId").GetGuid();
        var approved = await PostSaleAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], discount, approvalId, [Pay("Cash", "NIO", 750m)]);
        Assert.Equal(750m, approved.GetProperty("sale").GetProperty("totalNio").GetDecimal());

        var reused = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], discount, approvalId, [Pay("Cash", "NIO", 750m)]);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, reused.StatusCode);

        // La autorización es realmente de un solo uso incluso si dos cobros llegan juntos.
        var concurrentApproval = await PostAsync(seller.Client, seller.Csrf, "/api/v1/pos/discount-approvals", new { username = CatalogApiFixture.AdminUsername, password = CatalogApiFixture.DefaultPassword });
        var concurrentApprovalId = concurrentApproval.GetProperty("approvalId").GetGuid();
        var concurrent = await Task.WhenAll(
            PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], discount, concurrentApprovalId, [Pay("Cash", "NIO", 750m)]),
            PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], discount, concurrentApprovalId, [Pay("Cash", "NIO", 750m)]));
        Assert.Single(concurrent, response => response.StatusCode == HttpStatusCode.Created);
        var rejectedConcurrentDiscount = Assert.Single(concurrent, response => response.StatusCode == HttpStatusCode.UnprocessableEntity);
        Assert.Equal("discount_not_authorized", await ApiTestHelpers.ReadProblemCodeAsync(rejectedConcurrentDiscount));

        var insufficient = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], null, null, [Pay("Cash", "NIO", 900m)]);
        Assert.Equal("payment_insufficient", await ApiTestHelpers.ReadProblemCodeAsync(insufficient));
        // Los dólares se aceptan por tarjeta, pero un pago de más sin efectivo no tiene cambio posible.
        var usdCard = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], null, null, [Pay("Card", "USD", 30m, 36.7m)]);
        Assert.Equal("payment_exceeds_total", await ApiTestHelpers.ReadProblemCodeAsync(usdCard));
        var usdWithoutRate = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], null, null, [Pay("Transfer", "USD", 27.25m)]);
        Assert.Equal(HttpStatusCode.BadRequest, usdWithoutRate.StatusCode);
        var changeWithoutCash = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], null, null, [Pay("Transfer", "NIO", 1200m, bank: "BAC")]);
        Assert.Equal("payment_exceeds_total", await ApiTestHelpers.ReadProblemCodeAsync(changeWithoutCash));

        _ = await PostAsync(seller.Client, seller.Csrf, $"/api/v1/cash/sessions/{session}/close", new { countedCashNio = 1500m, countedCashUsd = 0m });
    }

    [PostgresFact]
    public async Task OnlineSaleRejectsAClientPriceDifferentFromTheOfficialPrice()
    {
        var catalogs = await LoadCatalogsAsync();
        var product = await CreateProductAsync(catalogs, "Precio protegido", 1000m, [(3, null)]);
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        var seller = await CreateSellerAsync();
        var session = await OpenCashAsync(seller, 0m, 0m);

        var manipulated = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1m)], null, null,
            [Pay("Cash", "NIO", 1m)]);
        Assert.Equal(HttpStatusCode.Conflict, manipulated.StatusCode);
        Assert.Equal("price_changed", await ApiTestHelpers.ReadProblemCodeAsync(manipulated));

        var staleRate = await PostSaleRawAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], null, null,
            [Pay("Cash", "USD", 1000m, 1m)]);
        Assert.Equal(HttpStatusCode.Conflict, staleRate.StatusCode);
        Assert.Equal("exchange_rate_changed", await ApiTestHelpers.ReadProblemCodeAsync(staleRate));

        var detail = await GetAsync(fixture.Admin, $"/api/v1/products/{product.GetProperty("id").GetGuid()}");
        Assert.Equal(3, detail.GetProperty("variants")[0].GetProperty("stock").GetInt32());
        _ = await PostAsync(seller.Client, seller.Csrf, $"/api/v1/cash/sessions/{session}/close", new { countedCashNio = 0m, countedCashUsd = 0m });
    }

    [PostgresFact]
    public async Task DollarsInEveryMethodAreReconciledByMethodAndCurrencyAtClosing()
    {
        var catalogs = await LoadCatalogsAsync();
        var product = await CreateProductAsync(catalogs, "Pantalón conciliación", 1000m, [(20, null)]);
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        var seller = await CreateSellerAsync();
        var session = await OpenCashAsync(seller, 0m, 0m);

        // Venta A (C$ 1,000): transferencia US$ 10 (= C$ 367) + tarjeta C$ 400 + efectivo C$ 233.
        _ = await PostSaleAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 1000m)], null, null,
            [Pay("Transfer", "USD", 10m, 36.7m, "BAC"), Pay("Card", "NIO", 400m), Pay("Cash", "NIO", 233m)]);
        // Venta B (C$ 734): tarjeta en dólares US$ 20.
        _ = await PostSaleAsync(seller, session, Guid.NewGuid(), [(variantId, 1, 734m)], null, null, [Pay("Card", "USD", 20m, 36.7m)]);

        var summary = await GetAsync(seller.Client, $"/api/v1/cash/sessions/{session}/summary");
        var totals = summary.GetProperty("totals");
        Assert.Equal(1734m, totals.GetProperty("netTotalNio").GetDecimal());
        Assert.Equal(10m, totals.GetProperty("transferUsdTendered").GetDecimal());
        Assert.Equal(0m, totals.GetProperty("transferNioTendered").GetDecimal());
        Assert.Equal(367m, totals.GetProperty("transferTotalNio").GetDecimal());
        Assert.Equal(400m, totals.GetProperty("cardNioTendered").GetDecimal());
        Assert.Equal(20m, totals.GetProperty("cardUsdTendered").GetDecimal());
        Assert.Equal(1134m, totals.GetProperty("cardTotalNio").GetDecimal());
        Assert.Equal(233m, totals.GetProperty("cashTotalNio").GetDecimal());
        Assert.Equal(
            totals.GetProperty("netTotalNio").GetDecimal(),
            totals.GetProperty("cashTotalNio").GetDecimal() + totals.GetProperty("transferTotalNio").GetDecimal() + totals.GetProperty("cardTotalNio").GetDecimal());
        var bank = totals.GetProperty("transfersByBank")[0];
        Assert.Equal("BAC", bank.GetProperty("bank").GetString());
        Assert.Equal(10m, bank.GetProperty("totalUsd").GetDecimal());
        Assert.Equal(10m, summary.GetProperty("expectedTransferUsd").GetDecimal());
        Assert.Equal(400m, summary.GetProperty("expectedCardNio").GetDecimal());
        Assert.Equal(20m, summary.GetProperty("expectedCardUsd").GetDecimal());
        Assert.Equal(JsonValueKind.Null, summary.GetProperty("differenceCardNio").ValueKind);

        // Cierre: la terminal marca C$ 390 (faltan 10) y US$ 20; el banco muestra US$ 10; las transferencias en C$ no se verifican.
        var closed = await PostAsync(seller.Client, seller.Csrf, $"/api/v1/cash/sessions/{session}/close", new
        {
            countedCashNio = 233m,
            countedCashUsd = 0m,
            countedTransferUsd = 10m,
            countedCardNio = 390m,
            countedCardUsd = 20m,
        });
        Assert.Equal(0m, closed.GetProperty("differenceCashNio").GetDecimal());
        Assert.Equal(0m, closed.GetProperty("differenceTransferUsd").GetDecimal());
        Assert.Equal(JsonValueKind.Null, closed.GetProperty("differenceTransferNio").ValueKind);
        Assert.Equal(-10m, closed.GetProperty("differenceCardNio").GetDecimal());
        Assert.Equal(0m, closed.GetProperty("differenceCardUsd").GetDecimal());
        Assert.Equal(390m, closed.GetProperty("session").GetProperty("countedCardNio").GetDecimal());

        var negative = await PostRawAsync(seller.Client, seller.Csrf, $"/api/v1/cash/sessions/{session}/close", new { countedCashNio = 0m, countedCashUsd = 0m, countedCardNio = -5m });
        Assert.Equal(HttpStatusCode.Conflict, negative.StatusCode); // ya estaba cerrada

        var today = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(-6)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var consolidated = await GetAsync(fixture.Admin, $"/api/v1/cash/consolidated?date={today}");
        Assert.True(consolidated.GetProperty("expectedCardUsd").GetDecimal() >= 20m);
        Assert.True(consolidated.GetProperty("expectedTransferUsd").GetDecimal() >= 10m);
    }

    [PostgresFact]
    public async Task TwoRegistersSellingTheLastUnitAtTheSameTimeOnlyOneWins()
    {
        var catalogs = await LoadCatalogsAsync();
        var product = await CreateProductAsync(catalogs, "Falda última unidad", 300m, [(1, null)]);
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        var one = await CreateSellerAsync();
        var two = await CreateSellerAsync();
        var sessionOne = await OpenCashAsync(one, 0m, 0m);
        var sessionTwo = await OpenCashAsync(two, 0m, 0m);
        Assert.NotEqual(sessionOne, sessionTwo);

        var responses = await Task.WhenAll(
            PostSaleRawAsync(one, sessionOne, Guid.NewGuid(), [(variantId, 1, 300m)], null, null, [Pay("Cash", "NIO", 300m)]),
            PostSaleRawAsync(two, sessionTwo, Guid.NewGuid(), [(variantId, 1, 300m)], null, null, [Pay("Cash", "NIO", 300m)]));

        // Exactamente una caja se lleva la última unidad; la otra recibe «sin existencias» y el saldo nunca es negativo.
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
        var rejected = Assert.Single(responses, response => response.StatusCode == HttpStatusCode.UnprocessableEntity);
        Assert.Equal("insufficient_stock", await ApiTestHelpers.ReadProblemCodeAsync(rejected));
        var detail = await GetAsync(fixture.Admin, $"/api/v1/products/{product.GetProperty("id").GetGuid()}");
        Assert.Equal(0, detail.GetProperty("variants")[0].GetProperty("stock").GetInt32());

        var busy = await PostRawAsync(one.Client, one.Csrf, "/api/v1/cash/sessions", new { registerId = (await GetAsync(one.Client, "/api/v1/cash/registers"))[0].GetProperty("id").GetGuid(), openingFloatNio = 0, openingFloatUsd = 0 });
        Assert.Equal(HttpStatusCode.Conflict, busy.StatusCode);

        _ = await PostAsync(one.Client, one.Csrf, $"/api/v1/cash/sessions/{sessionOne}/close", new { countedCashNio = 300m, countedCashUsd = 0m });
        _ = await PostAsync(two.Client, two.Csrf, $"/api/v1/cash/sessions/{sessionTwo}/close", new { countedCashNio = 0m, countedCashUsd = 0m });
    }

    [PostgresFact]
    public async Task ImportValidatesEverythingBeforeSavingAnything()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var rows = new object[]
        {
            Row($"Pantalón importado {suffix}", "Dama", "Marca importada", "Straight Fit", "30", "Negro", $"IMP-{suffix}-A", 900m, null, 4),
            Row($"Pantalón importado {suffix}", "Dama", "Marca importada", "Straight Fit", "32", "Negro", null, 950m, null, 2),
        };

        var withoutCreate = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products/import", new { dryRun = true, createMissingCatalogs = false, rows });
        Assert.Contains(withoutCreate.GetProperty("errors").EnumerateArray(), error => error.GetProperty("message").GetString()!.Contains("no existe", StringComparison.Ordinal));

        var dry = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products/import", new { dryRun = true, createMissingCatalogs = true, rows });
        Assert.Empty(dry.GetProperty("errors").EnumerateArray());
        Assert.Equal(1, dry.GetProperty("productsCreated").GetInt32());
        Assert.Equal(2, dry.GetProperty("variantsCreated").GetInt32());
        Assert.Equal(6, dry.GetProperty("unitsLoaded").GetInt32());
        var none = await GetAsync(fixture.Admin, $"/api/v1/products?search=importado%20{suffix}");
        Assert.Equal(0, none.GetProperty("totalCount").GetInt32());

        var real = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products/import", new { dryRun = false, createMissingCatalogs = true, rows });
        Assert.Empty(real.GetProperty("errors").EnumerateArray());
        var found = await GetAsync(fixture.Admin, $"/api/v1/products?search=importado%20{suffix}");
        Assert.Equal(1, found.GetProperty("totalCount").GetInt32());
        var productId = found.GetProperty("items")[0].GetProperty("id").GetGuid();
        var detail = await GetAsync(fixture.Admin, $"/api/v1/products/{productId}");
        Assert.Equal(2, detail.GetProperty("variants").GetArrayLength());
        Assert.Equal(6, detail.GetProperty("totalStock").GetInt32());
        // Segunda variante sin código: el servidor generó un EAN-13 interno.
        Assert.Contains(detail.GetProperty("variants").EnumerateArray(), v => v.GetProperty("barcode").GetString()!.StartsWith("20", StringComparison.Ordinal) && v.GetProperty("barcode").GetString()!.Length == 13);

        var repeated = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products/import", new { dryRun = true, createMissingCatalogs = true, rows });
        Assert.Contains(repeated.GetProperty("errors").EnumerateArray(), error => error.GetProperty("message").GetString()!.Contains("ya existe", StringComparison.Ordinal));
    }

    [PostgresFact]
    public async Task SellersCannotSeeCostsAdjustInventoryOrReadReports()
    {
        var catalogs = await LoadCatalogsAsync();
        var product = await CreateProductAsync(catalogs, "Short con costo", 400m, [(5, 150m)]);
        var productId = product.GetProperty("id").GetGuid();
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        Assert.Equal(150m, product.GetProperty("variants")[0].GetProperty("cost").GetDecimal());

        var seller = await CreateSellerAsync();
        var asSeller = await GetAsync(seller.Client, $"/api/v1/products/{productId}");
        Assert.True(asSeller.GetProperty("variants")[0].GetProperty("cost").ValueKind is JsonValueKind.Null);

        var adjust = await PostRawAsync(seller.Client, seller.Csrf, "/api/v1/inventory/adjustments", new { variantId, kind = "Entry", delta = 1, reason = "Prueba" });
        Assert.Equal(HttpStatusCode.Forbidden, adjust.StatusCode);
        foreach (var url in new[] { "/api/v1/sales", "/api/v1/audit", "/api/v1/cash/consolidated", "/api/v1/settings/../users" })
        {
            var response = await seller.Client.GetAsync(new Uri(url, UriKind.Relative));
            Assert.True(response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound, url);
        }

        var negative = await PostRawAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/inventory/adjustments", new { variantId, kind = "Loss", delta = -99, reason = "Pérdida imposible" });
        Assert.Equal("negative_stock", await ApiTestHelpers.ReadProblemCodeAsync(negative));
        var entry = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/inventory/adjustments", new { variantId, kind = "Entry", delta = 4, reason = "Llegó mercadería" });
        Assert.Equal(9, entry.GetProperty("newStock").GetInt32());

        var settings = await GetAsync(seller.Client, "/api/v1/settings");
        Assert.Equal(36.7m, settings.GetProperty("usdRate").GetDecimal());
        var denied = await seller.Client.SendAsync(ApiTestHelpers.Build(HttpMethod.Put, "/api/v1/settings", seller.Csrf, new { usdRate = 1 }));
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        var audit = await GetAsync(fixture.Admin, "/api/v1/audit?entityType=Variant");
        Assert.True(audit.GetProperty("totalCount").GetInt32() >= 1);
    }

    // ---------------------------------------------------------------- ayudas

    private static object Pay(string method, string currency, decimal amount, decimal? rate = null, string? bank = null) =>
        new { method, currency, amount, exchangeRate = rate, bank, reference = (string?)null };

    private static object Row(string name, string category, string brand, string cut, string size, string color, string? barcode, decimal price, decimal? cost, int quantity) =>
        new { productName = name, category, brand, cut, size, color, barcode, price, cost, quantity };

    private async Task<Catalogs> LoadCatalogsAsync()
    {
        async Task<Guid[]> Ids(string kind)
        {
            var page = await GetAsync(fixture.Admin, $"/api/v1/catalog/{kind}?pageSize=100");
            return page.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        }

        var categories = await Ids("categories");
        var brands = await Ids("brands");
        var sizes = await Ids("sizes");
        var colors = await Ids("colors");
        return new Catalogs(categories[0], brands[0], sizes, colors);
    }

    private async Task<JsonElement> CreateProductAsync(Catalogs catalogs, string name, decimal price, (int Quantity, decimal? Cost)[] variants)
    {
        var suffix = Interlocked.Increment(ref _counter);
        var body = new
        {
            name = $"{name} {suffix}",
            categoryId = catalogs.Category,
            brandId = catalogs.Brand,
            cutId = (Guid?)null,
            basePrice = price,
            variants = variants.Select((variant, index) => new
            {
                sizeId = catalogs.Sizes[index],
                colorId = catalogs.Colors[0],
                barcode = (string?)null,
                priceOverride = (decimal?)null,
                cost = variant.Cost,
                initialQuantity = variant.Quantity,
            }).ToArray(),
        };
        return await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products", body, HttpStatusCode.Created);
    }

    private async Task<Seller> CreateSellerAsync()
    {
        var roles = await GetAsync(fixture.Admin, "/api/v1/users/roles");
        var roleId = roles.EnumerateArray().Single(role => role.GetProperty("name").GetString() == "Vendedor").GetProperty("id").GetGuid();
        var username = string.Create(CultureInfo.InvariantCulture, $"vendedor.mvp{Interlocked.Increment(ref _counter)}");
        _ = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/users",
            new { username, displayName = $"Vendedor {username}", password = CatalogApiFixture.DefaultPassword, roleIds = new[] { roleId } }, HttpStatusCode.Created);
        var client = fixture.CreateClient();
        var csrf = await ApiTestHelpers.LoginAsync(client, username, CatalogApiFixture.DefaultPassword);
        return new Seller(client, csrf, username);
    }

    private static async Task<Guid> OpenCashAsync(Seller seller, decimal floatNio, decimal floatUsd)
    {
        var registers = await GetAsync(seller.Client, "/api/v1/cash/registers");
        foreach (var register in registers.EnumerateArray().Where(register => register.GetProperty("openSession").ValueKind == JsonValueKind.Null))
        {
            var response = await PostRawAsync(seller.Client, seller.Csrf, "/api/v1/cash/sessions",
                new { registerId = register.GetProperty("id").GetGuid(), openingFloatNio = floatNio, openingFloatUsd = floatUsd });
            if (response.StatusCode == HttpStatusCode.Created)
            {
                return (await ReadAsync(response)).GetProperty("id").GetGuid();
            }
        }

        throw new InvalidOperationException("No hay una caja libre para la prueba.");
    }

    private static Task<HttpResponseMessage> PostSaleRawAsync(
        Seller seller,
        Guid session,
        Guid clientSaleId,
        (Guid Variant, int Quantity, decimal Price)[] lines,
        object? discount,
        Guid? approvalId,
        object[] payments,
        bool isOffline = false) =>
        PostRawAsync(seller.Client, seller.Csrf, "/api/v1/pos/sales", new
        {
            clientSaleId,
            cashSessionId = session,
            channel = "Store",
            createdAtUtc = DateTimeOffset.UtcNow,
            isOffline,
            lines = lines.Select(line => new { variantId = line.Variant, quantity = line.Quantity, unitPrice = line.Price }).ToArray(),
            discount,
            discountApprovalId = approvalId,
            payments,
            note = (string?)null,
        });

    private static async Task<JsonElement> PostSaleAsync(
        Seller seller,
        Guid session,
        Guid clientSaleId,
        (Guid Variant, int Quantity, decimal Price)[] lines,
        object? discount,
        Guid? approvalId,
        object[] payments,
        HttpStatusCode expected = HttpStatusCode.Created)
    {
        using var response = await PostSaleRawAsync(seller, session, clientSaleId, lines, discount, approvalId, payments);
        Assert.Equal(expected, response.StatusCode);
        return await ReadAsync(response);
    }

    private static async Task<JsonElement> GetAsync(HttpClient client, string url)
    {
        using var response = await client.GetAsync(new Uri(url, UriKind.Relative));
        Assert.True(response.IsSuccessStatusCode, $"GET {url} → {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await ReadAsync(response);
    }

    private static async Task<JsonElement> PostAsync(HttpClient client, string csrf, string url, object body, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using var response = await PostRawAsync(client, csrf, url, body);
        Assert.True(response.StatusCode == expected, $"POST {url} → {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await ReadAsync(response);
    }

    private static async Task<HttpResponseMessage> PostRawAsync(HttpClient client, string csrf, string url, object body)
    {
        using var request = ApiTestHelpers.Build(HttpMethod.Post, url, csrf, body);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        return JsonDocument.Parse(text).RootElement.Clone();
    }
}
