using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;

namespace LaGanga.Api.Tests;

/// <summary>Socios, entradas de mercadería con costo y precio, salida PEPS y reportes de inversión.</summary>
public sealed class InvestmentTests(CatalogApiFixture fixture) : IClassFixture<CatalogApiFixture>
{
    private static int _counter;

    private sealed record Seller(HttpClient Client, string Csrf);

    [PostgresFact]
    public async Task SalesConsumeTheOldestEntryFirstAndProfitIsAttributedToEachPartner()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var ana = await CreatePartnerAsync($"Ana {suffix}");
        var beto = await CreatePartnerAsync($"Beto {suffix}");
        var duplicate = await PostRawAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/investment/partners", new { name = $"ana {suffix}" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        // Entrada 1: Ana trae 5 a costo 100. Entrada 2: Beto trae 5 a costo 150 (precio dado 320).
        var product = await CreateProductAsync($"Pantalón socios {suffix}", 300m, quantity: 5, cost: 100m, partnerId: ana);
        var productId = product.GetProperty("id").GetGuid();
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        await Task.Delay(30);
        var entry = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/inventory/adjustments",
            new { variantId, kind = "Entry", delta = 5, reason = "Llegó mercadería de Beto", partnerId = beto, unitCost = 150m, unitPrice = 320m });
        Assert.Equal(10, entry.GetProperty("newStock").GetInt32());

        var lots = await GetAsync(fixture.Admin, $"/api/v1/investment/lots?search={Uri.EscapeDataString($"Pantalón socios {suffix}")}");
        Assert.Equal(2, lots.GetProperty("totalCount").GetInt32());
        var anaLot = lots.GetProperty("items").EnumerateArray().Single(lot => lot.GetProperty("partnerId").GetGuid() == ana);
        Assert.Equal(100m, anaLot.GetProperty("unitCost").GetDecimal());
        Assert.Equal(300m, anaLot.GetProperty("unitPrice").GetDecimal());
        var betoLot = lots.GetProperty("items").EnumerateArray().Single(lot => lot.GetProperty("partnerId").GetGuid() == beto);
        Assert.Equal(320m, betoLot.GetProperty("unitPrice").GetDecimal());

        // Se venden 7: 5 salen de la entrada de Ana y 2 de la de Beto (PEPS).
        var seller = await CreateSellerAsync();
        var session = await OpenCashAsync(seller);
        var sale = await PostSaleAsync(seller, session, variantId, 7, 300m, null, 2100m);
        var saleId = sale.GetProperty("sale").GetProperty("id").GetGuid();

        var summary = await GetAsync(fixture.Admin, "/api/v1/investment/summary");
        var anaRow = Row(summary, ana);
        Assert.Equal(5, anaRow.GetProperty("unitsEntered").GetInt32());
        Assert.Equal(500m, anaRow.GetProperty("investedNio").GetDecimal());
        Assert.Equal(0, anaRow.GetProperty("unitsInStock").GetInt32());
        Assert.Equal(5, anaRow.GetProperty("unitsSold").GetInt32());
        Assert.Equal(1500m, anaRow.GetProperty("revenueNio").GetDecimal());
        Assert.Equal(500m, anaRow.GetProperty("costOfSoldNio").GetDecimal());
        Assert.Equal(1000m, anaRow.GetProperty("profitNio").GetDecimal());
        var betoRow = Row(summary, beto);
        Assert.Equal(750m, betoRow.GetProperty("investedNio").GetDecimal());
        Assert.Equal(3, betoRow.GetProperty("unitsInStock").GetInt32());
        Assert.Equal(450m, betoRow.GetProperty("stockAtCostNio").GetDecimal());
        Assert.Equal(900m, betoRow.GetProperty("stockAtPriceNio").GetDecimal());
        Assert.Equal(2, betoRow.GetProperty("unitsSold").GetInt32());
        Assert.Equal(600m, betoRow.GetProperty("revenueNio").GetDecimal());
        Assert.Equal(300m, betoRow.GetProperty("profitNio").GetDecimal());

        // Anular devuelve las unidades a su entrada original y desaparece lo vendido.
        _ = await PostAsync(fixture.Admin, fixture.AdminCsrf, $"/api/v1/sales/{saleId}/void", new { reason = "Prueba de anulación" });
        var afterVoid = await GetAsync(fixture.Admin, "/api/v1/investment/summary");
        Assert.Equal(5, Row(afterVoid, ana).GetProperty("unitsInStock").GetInt32());
        Assert.Equal(5, Row(afterVoid, beto).GetProperty("unitsInStock").GetInt32());
        Assert.Equal(0, Row(afterVoid, ana).GetProperty("unitsSold").GetInt32());

        // Venta con 10 % de descuento: el ingreso se reparte con el descuento aplicado.
        _ = await PostSaleAsync(seller, session, variantId, 1, 300m, new { type = "Percent", value = 10m }, 270m);
        var discounted = Row(await GetAsync(fixture.Admin, "/api/v1/investment/summary"), ana);
        Assert.Equal(270m, discounted.GetProperty("revenueNio").GetDecimal());
        Assert.Equal(170m, discounted.GetProperty("profitNio").GetDecimal());

        // Una pérdida también sale de la entrada más antigua y se ve por socio.
        _ = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/inventory/adjustments", new { variantId, kind = "Loss", delta = -2, reason = "Prenda manchada" });
        var withLoss = Row(await GetAsync(fixture.Admin, "/api/v1/investment/summary"), ana);
        Assert.Equal(2, withLoss.GetProperty("lossUnits").GetInt32());
        Assert.Equal(200m, withLoss.GetProperty("lossCostNio").GetDecimal());

        // El control por entradas siempre cuadra con la existencia real (10 − 1 − 2 = 7).
        var detail = await GetAsync(fixture.Admin, $"/api/v1/products/{productId}");
        Assert.Equal(7, detail.GetProperty("variants")[0].GetProperty("stock").GetInt32());
        var remaining = (await GetAsync(fixture.Admin, $"/api/v1/investment/lots?search={Uri.EscapeDataString($"Pantalón socios {suffix}")}"))
            .GetProperty("items").EnumerateArray().Sum(lot => lot.GetProperty("quantityRemaining").GetInt32());
        Assert.Equal(7, remaining);

        // Filtro del inventario por socio.
        var filtered = await GetAsync(fixture.Admin, $"/api/v1/inventory?partnerId={beto}&pageSize=100");
        var row = filtered.GetProperty("items").EnumerateArray().Single(item => item.GetProperty("variantId").GetGuid() == variantId);
        Assert.Equal(5, row.GetProperty("partnerStock").GetInt32());
        Assert.Equal(2, row.GetProperty("partners").GetArrayLength());
        var withoutPartner = await GetAsync(fixture.Admin, "/api/v1/inventory?partnerId=none&pageSize=100");
        Assert.DoesNotContain(withoutPartner.GetProperty("items").EnumerateArray(), item => item.GetProperty("variantId").GetGuid() == variantId);

        // Corregir una entrada cambia todo su historial.
        var edited = await PutAsync(fixture.Admin, fixture.AdminCsrf, $"/api/v1/investment/lots/{anaLot.GetProperty("id").GetGuid()}",
            new { partnerId = ana, unitCost = 120m, unitPrice = 310m, note = "Costo corregido" });
        Assert.Equal(120m, edited.GetProperty("unitCost").GetDecimal());
        Assert.Equal(600m, Row(await GetAsync(fixture.Admin, "/api/v1/investment/summary"), ana).GetProperty("investedNio").GetDecimal());
        var audit = await GetAsync(fixture.Admin, "/api/v1/audit?entityType=StockLot");
        Assert.True(audit.GetProperty("totalCount").GetInt32() >= 1);

        var breakdown = await GetAsync(fixture.Admin, $"/api/v1/investment/breakdown?partnerId={ana}");
        Assert.Contains(breakdown.EnumerateArray(), item => item.GetProperty("productId").GetGuid() == productId);

        var excel = await fixture.Admin.GetAsync(new Uri("/api/v1/reports/investment", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, excel.StatusCode);
        using var workbook = new XLWorkbook(new MemoryStream(await excel.Content.ReadAsByteArrayAsync()));
        Assert.Equal(["Resumen por socio", "Por producto", "Entradas"], workbook.Worksheets.Select(sheet => sheet.Name).ToArray());
        Assert.Contains(workbook.Worksheet("Resumen por socio").CellsUsed(), cell => cell.GetString() == $"Ana {suffix}");

        _ = await PostAsync(seller.Client, seller.Csrf, $"/api/v1/cash/sessions/{session}/close", new { countedCashNio = 270m, countedCashUsd = 0m });
    }

    [PostgresFact]
    public async Task OfflineOversellDeficitIsCoveredByTheNextEntryAndLotsStayInSync()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var ana = await CreatePartnerAsync($"Ana deficit {suffix}");
        var beto = await CreatePartnerAsync($"Beto deficit {suffix}");
        var product = await CreateProductAsync($"Camisa deficit {suffix}", 500m, quantity: 1, cost: 200m, partnerId: ana);
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();
        var seller = await CreateSellerAsync();
        var session = await OpenCashAsync(seller);

        // Venta sin conexión de 3 con una sola unidad: se acepta, queda en -2 y 2 unidades sin entrada.
        using var offline = ApiTestHelpers.Build(HttpMethod.Post, "/api/v1/pos/sales", seller.Csrf, SaleBody(session, variantId, 3, 500m, null, 1500m, offline: true));
        Assert.Equal(HttpStatusCode.Created, (await seller.Client.SendAsync(offline)).StatusCode);
        Assert.Equal(-2, (await GetAsync(fixture.Admin, $"/api/v1/products/{product.GetProperty("id").GetGuid()}")).GetProperty("variants")[0].GetProperty("stock").GetInt32());
        var noPartner = Row(await GetAsync(fixture.Admin, "/api/v1/investment/summary"), null);
        Assert.True(noPartner.GetProperty("soldUnitsWithoutCost").GetInt32() >= 2);

        // Llega mercadería de Beto: 5 unidades, 2 cubren el faltante y quedan 3.
        var entry = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/inventory/adjustments",
            new { variantId, kind = "Entry", delta = 5, reason = "Reposición", partnerId = beto, unitCost = 210m });
        Assert.Equal(3, entry.GetProperty("newStock").GetInt32());
        var lots = (await GetAsync(fixture.Admin, $"/api/v1/investment/lots?search={Uri.EscapeDataString($"Camisa deficit {suffix}")}")).GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(3, lots.Sum(lot => lot.GetProperty("quantityRemaining").GetInt32()));
        Assert.Equal(3, lots.Single(lot => lot.GetProperty("partnerId").ValueKind != JsonValueKind.Null && lot.GetProperty("partnerId").GetGuid() == beto).GetProperty("quantityRemaining").GetInt32());

        _ = await PostAsync(seller.Client, seller.Csrf, $"/api/v1/cash/sessions/{session}/close", new { countedCashNio = 1500m, countedCashUsd = 0m });
    }

    [PostgresFact]
    public async Task SellersCannotSeePartnersButTheInventoryManagerCanEnterStockWithThem()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var partner = await CreatePartnerAsync($"Socia privada {suffix}");
        var product = await CreateProductAsync($"Blusa privada {suffix}", 400m, quantity: 2, cost: 150m, partnerId: partner);
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();

        var roles = await GetAsync(fixture.Admin, "/api/v1/users/roles");
        async Task<(HttpClient Client, string Csrf)> LoginAsRoleAsync(string roleName)
        {
            var roleId = roles.EnumerateArray().Single(role => role.GetProperty("name").GetString() == roleName).GetProperty("id").GetGuid();
            var username = string.Create(CultureInfo.InvariantCulture, $"usuario.inv{Interlocked.Increment(ref _counter)}");
            _ = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/users",
                new { username, displayName = $"Usuario {roleName}", password = CatalogApiFixture.DefaultPassword, roleIds = new[] { roleId } }, HttpStatusCode.Created);
            var client = fixture.CreateClient();
            return (client, await ApiTestHelpers.LoginAsync(client, username, CatalogApiFixture.DefaultPassword));
        }

        // El vendedor no ve socios ni puede crearlos.
        var (seller, sellerCsrf) = await LoginAsRoleAsync("Vendedor");
        using (seller)
        {
            foreach (var url in new[] { "/api/v1/investment/partners", "/api/v1/investment/summary", "/api/v1/investment/lots", "/api/v1/reports/investment" })
            {
                Assert.Equal(HttpStatusCode.Forbidden, (await seller.GetAsync(new Uri(url, UriKind.Relative))).StatusCode);
            }

            Assert.Equal(HttpStatusCode.Forbidden, (await PostRawAsync(seller, sellerCsrf, "/api/v1/investment/partners", new { name = "Intruso" })).StatusCode);
        }

        // El encargado de inventario ingresa mercadería con su socio y ve el costo, pero no las ventas.
        var (manager, managerCsrf) = await LoginAsRoleAsync("Encargado de inventario");
        using (manager)
        {
            Assert.Equal(HttpStatusCode.OK, (await manager.GetAsync(new Uri("/api/v1/investment/partners", UriKind.Relative))).StatusCode);
            var entry = await PostAsync(manager, managerCsrf, "/api/v1/inventory/adjustments", new { variantId, kind = "Entry", delta = 1, reason = "Entrada con socio", partnerId = partner, unitCost = 150m });
            Assert.Equal(3, entry.GetProperty("newStock").GetInt32());
            var inventory = await GetAsync(manager, "/api/v1/inventory?pageSize=100");
            var row = inventory.GetProperty("items").EnumerateArray().First(item => item.GetProperty("variantId").GetGuid() == variantId);
            Assert.Equal(150m, row.GetProperty("cost").GetDecimal());
            Assert.Equal(HttpStatusCode.Forbidden, (await manager.GetAsync(new Uri("/api/v1/sales", UriKind.Relative))).StatusCode);
        }

        var lots = await GetAsync(fixture.Admin, $"/api/v1/investment/lots?partnerId={partner}&pageSize=100");
        Assert.Contains(lots.GetProperty("items").EnumerateArray(), item => item.GetProperty("variantId").GetGuid() == variantId && item.GetProperty("quantityIn").GetInt32() == 1);
    }

    [PostgresFact]
    public async Task ImportCanAssignPartnersAndCreateTheMissingOnes()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var rows = new[]
        {
            new { productName = $"Short importado socio {suffix}", category = "Dama", brand = "Marca socio", cut = (string?)null, size = "S", color = "Negro", barcode = (string?)null, price = 350m, cost = (decimal?)120m, quantity = 4, partner = (string?)$"Carla {suffix}" },
        };

        var strict = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products/import", new { dryRun = true, createMissingCatalogs = true, createMissingPartners = false, rows });
        Assert.Contains(strict.GetProperty("errors").EnumerateArray(), error => error.GetProperty("message").GetString()!.Contains("no existe", StringComparison.Ordinal));

        var real = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products/import", new { dryRun = false, createMissingCatalogs = true, createMissingPartners = true, rows });
        Assert.Empty(real.GetProperty("errors").EnumerateArray());
        var partners = await GetAsync(fixture.Admin, "/api/v1/investment/partners");
        Assert.Contains(partners.EnumerateArray(), item => item.GetProperty("name").GetString() == $"Carla {suffix}");
        var lots = await GetAsync(fixture.Admin, $"/api/v1/investment/lots?search={Uri.EscapeDataString($"Short importado socio {suffix}")}");
        var lot = Assert.Single(lots.GetProperty("items").EnumerateArray());
        Assert.Equal($"Carla {suffix}", lot.GetProperty("partnerName").GetString());
        Assert.Equal("Import", lot.GetProperty("source").GetString());
        Assert.Equal(120m, lot.GetProperty("unitCost").GetDecimal());
        Assert.Equal(350m, lot.GetProperty("unitPrice").GetDecimal());
    }

    // ---------------------------------------------------------------- ayudas

    private static JsonElement Row(JsonElement summary, Guid? partnerId) =>
        summary.GetProperty("partners").EnumerateArray().Single(row =>
            partnerId is null ? row.GetProperty("partnerId").ValueKind == JsonValueKind.Null : row.GetProperty("partnerId").ValueKind != JsonValueKind.Null && row.GetProperty("partnerId").GetGuid() == partnerId);

    private async Task<Guid> CreatePartnerAsync(string name) =>
        (await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/investment/partners", new { name, phone = "8888-0000", notes = (string?)null }, HttpStatusCode.Created)).GetProperty("id").GetGuid();

    [PostgresFact]
    public async Task ProductEntryKeepsTheReceivedDateAndRejectsFutureDates()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var partner = await CreatePartnerAsync($"Fecha {suffix}");
        var today = DateOnly.FromDateTime(DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(-6)).DateTime);

        var future = await PostRawAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products",
            await ProductBodyAsync($"Camisa futura {suffix}", 500m, 2, 200m, partner, today.AddDays(2)));
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);

        var received = today.AddDays(-3);
        _ = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products",
            await ProductBodyAsync($"Camisa oxford fecha {suffix}", 500m, 4, 200m, partner, received), HttpStatusCode.Created);
        var lots = await GetAsync(fixture.Admin, $"/api/v1/investment/lots?search={Uri.EscapeDataString($"Camisa oxford fecha {suffix}")}");
        var lot = Assert.Single(lots.GetProperty("items").EnumerateArray());
        var entered = lot.GetProperty("enteredAtUtc").GetDateTimeOffset().ToOffset(TimeSpan.FromHours(-6));
        Assert.Equal(received, DateOnly.FromDateTime(entered.DateTime));
        Assert.Equal(4, lot.GetProperty("quantityIn").GetInt32());
    }

    [PostgresFact]
    public async Task ProductBarcodeIsSharedBySizesAndOpensTheProduct()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var code = $"FAB-{suffix}-{Guid.NewGuid():N}"[..20];
        async Task<Guid[]> Ids(string kind)
        {
            var page = await GetAsync(fixture.Admin, $"/api/v1/catalog/{kind}?pageSize=100");
            return page.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        }

        var sizes = await Ids("sizes");
        var colorId = (await Ids("colors"))[0];
        var categoryId = (await Ids("categories"))[0];
        var brandId = (await Ids("brands"))[0];
        object Body(string name, string? productBarcode, string? variantBarcode) => new
        {
            name,
            categoryId,
            brandId,
            cutId = (Guid?)null,
            basePrice = 690m,
            barcode = productBarcode,
            variants = new[]
            {
                new { sizeId = sizes[0], colorId, barcode = variantBarcode, priceOverride = (decimal?)null, cost = (decimal?)null, initialQuantity = 2, partnerId = (Guid?)null },
                new { sizeId = sizes[1], colorId, barcode = (string?)null, priceOverride = (decimal?)null, cost = (decimal?)null, initialQuantity = 3, partnerId = (Guid?)null },
            },
        };

        var created = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products", Body($"Pantalón Kalua {suffix}", code, null), HttpStatusCode.Created);
        var productId = created.GetProperty("id").GetGuid();
        Assert.Equal(code, created.GetProperty("barcode").GetString());

        // El código de fábrica abre el producto (no una talla).
        var match = await GetAsync(fixture.Admin, $"/api/v1/products/by-barcode/{code}");
        var found = match.GetProperty("product");
        Assert.Equal(productId, found.GetProperty("id").GetGuid());
        Assert.Equal(2, found.GetProperty("variants").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, match.GetProperty("colorId").ValueKind);
        using (var variantLookup = await fixture.Admin.GetAsync(new Uri($"/api/v1/variants/by-barcode/{code}", UriKind.Relative)))
        {
            Assert.Equal(HttpStatusCode.NotFound, variantLookup.StatusCode);
        }

        // No se puede repetir en otro producto ni como código de una talla.
        using (var duplicate = await PostRawAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products", Body($"Otro {suffix}", code, null)))
        {
            Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
            Assert.Equal("duplicate_barcode", await ApiTestHelpers.ReadProblemCodeAsync(duplicate));
        }

        using (var asVariant = await PostRawAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products", Body($"Otro talla {suffix}", null, code)))
        {
            Assert.Equal(HttpStatusCode.Conflict, asVariant.StatusCode);
        }

        // La caja recibe el código del producto en cada talla.
        var snapshot = await GetAsync(fixture.Admin, "/api/v1/pos/snapshot");
        var rows = snapshot.GetProperty("variants").EnumerateArray().Where(row => row.GetProperty("productId").GetGuid() == productId).ToList();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, row => Assert.Equal(code, row.GetProperty("productBarcode").GetString()));

        // Una cadena vacía lo quita.
        using var update = ApiTestHelpers.Build(HttpMethod.Put, $"/api/v1/products/{productId}", fixture.AdminCsrf, new
        {
            name = $"Pantalón Kalua {suffix}",
            categoryId,
            brandId,
            cutId = (Guid?)null,
            basePrice = 690m,
            isActive = true,
            barcode = string.Empty,
        }, created.GetProperty("version").GetInt64());
        using var updated = await fixture.Admin.SendAsync(update);
        Assert.True(updated.IsSuccessStatusCode, await updated.Content.ReadAsStringAsync());
        using var gone = await fixture.Admin.GetAsync(new Uri($"/api/v1/products/by-barcode/{code}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);

        // Un producto que tenía el código de fábrica en una talla: al pasarlo al producto, la talla recibe uno interno.
        var legacy = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products", Body($"Pantalón talla única {suffix}", null, code), HttpStatusCode.Created);
        var legacyId = legacy.GetProperty("id").GetGuid();
        using var move = ApiTestHelpers.Build(HttpMethod.Put, $"/api/v1/products/{legacyId}", fixture.AdminCsrf, new
        {
            name = $"Pantalón talla única {suffix}",
            categoryId,
            brandId,
            cutId = (Guid?)null,
            basePrice = 690m,
            isActive = true,
            barcode = code,
        }, legacy.GetProperty("version").GetInt64());
        using var moved = await fixture.Admin.SendAsync(move);
        Assert.True(moved.IsSuccessStatusCode, await moved.Content.ReadAsStringAsync());
        var reloaded = (await GetAsync(fixture.Admin, $"/api/v1/products/by-barcode/{code}")).GetProperty("product");
        Assert.Equal(legacyId, reloaded.GetProperty("id").GetGuid());
        Assert.DoesNotContain(reloaded.GetProperty("variants").EnumerateArray(), variant => variant.GetProperty("barcode").GetString() == code);
    }

    [PostgresFact]
    public async Task ProductWithoutSalesCanBeDeletedButSoldOnesCannot()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var partner = await CreatePartnerAsync($"Borrar {suffix}");
        var mistake = await CreateProductAsync($"Creado por error {suffix}", 400m, quantity: 5, cost: 150m, partnerId: partner);
        var mistakeId = mistake.GetProperty("id").GetGuid();

        using (var delete = ApiTestHelpers.Build(HttpMethod.Delete, $"/api/v1/products/{mistakeId}", fixture.AdminCsrf))
        using (var deleted = await fixture.Admin.SendAsync(delete))
        {
            Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        }

        using (var missing = await fixture.Admin.GetAsync(new Uri($"/api/v1/products/{mistakeId}", UriKind.Relative)))
        {
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        }

        var lots = await GetAsync(fixture.Admin, $"/api/v1/investment/lots?search={Uri.EscapeDataString($"Creado por error {suffix}")}");
        Assert.Empty(lots.GetProperty("items").EnumerateArray());

        // Con una venta, no se elimina: se debe desactivar.
        var sold = await CreateProductAsync($"Vendido {suffix}", 400m, quantity: 2, cost: 150m, partnerId: partner);
        var soldId = sold.GetProperty("id").GetGuid();
        var seller = await CreateSellerAsync();
        var session = await OpenCashAsync(seller);
        var soldVariant = sold.GetProperty("variants")[0].GetProperty("id").GetGuid();
        _ = await PostSaleAsync(seller, session, soldVariant, 1, 400m, null, 400m);

        // Balance de la ficha: lo vendido de cada variante, con su costo de la entrada.
        var summary = await GetAsync(fixture.Admin, $"/api/v1/products/{soldId}/sales-summary");
        var row = Assert.Single(summary.EnumerateArray());
        Assert.Equal(soldVariant, row.GetProperty("variantId").GetGuid());
        Assert.Equal(1, row.GetProperty("soldUnits").GetInt32());
        Assert.Equal(400m, row.GetProperty("soldRevenueNio").GetDecimal());
        Assert.Equal(150m, row.GetProperty("soldCostNio").GetDecimal());
        using var blocked = ApiTestHelpers.Build(HttpMethod.Delete, $"/api/v1/products/{soldId}", fixture.AdminCsrf);
        using var refused = await fixture.Admin.SendAsync(blocked);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("product_has_sales", await ApiTestHelpers.ReadProblemCodeAsync(refused));
        _ = await GetAsync(fixture.Admin, $"/api/v1/products/{soldId}");
    }

    [PostgresFact]
    public async Task EachColorCanHaveItsOwnFactoryCodeSharedBySizes()
    {
        var suffix = Interlocked.Increment(ref _counter);
        var unique = Guid.NewGuid().ToString("N")[..8];
        var blackCode = $"NEG-{unique}";
        var blueCode = $"AZU-{unique}";
        async Task<Guid[]> Ids(string kind)
        {
            var page = await GetAsync(fixture.Admin, $"/api/v1/catalog/{kind}?pageSize=100");
            return page.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        }

        var sizes = await Ids("sizes");
        var colors = await Ids("colors");
        var (black, blue) = (colors[0], colors[1]);
        object Variant(Guid size, Guid color) => new { sizeId = size, colorId = color, barcode = (string?)null, priceOverride = (decimal?)null, cost = (decimal?)null, initialQuantity = 1, partnerId = (Guid?)null };
        var created = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products", new
        {
            name = $"Pantalón Zolo {suffix}",
            categoryId = (await Ids("categories"))[0],
            brandId = (await Ids("brands"))[0],
            cutId = (Guid?)null,
            basePrice = 850m,
            variants = new[] { Variant(sizes[0], black), Variant(sizes[1], black), Variant(sizes[0], blue), Variant(sizes[1], blue) },
            colorBarcodes = new[] { new { colorId = black, barcode = blackCode } },
        }, HttpStatusCode.Created);
        var productId = created.GetProperty("id").GetGuid();
        Assert.Single(created.GetProperty("colorBarcodes").EnumerateArray());

        // El código del Negro abre el producto en Negro.
        var match = await GetAsync(fixture.Admin, $"/api/v1/products/by-barcode/{blackCode}");
        Assert.Equal(productId, match.GetProperty("product").GetProperty("id").GetGuid());
        Assert.Equal(black, match.GetProperty("colorId").GetGuid());

        // Se agrega el del Azul después; no se puede repetir.
        var csrf = fixture.AdminCsrf;
        using (var set = ApiTestHelpers.Build(HttpMethod.Put, $"/api/v1/products/{productId}/color-barcodes/{blue}", csrf, new { barcode = blueCode }))
        using (var setResponse = await fixture.Admin.SendAsync(set))
        {
            Assert.True(setResponse.IsSuccessStatusCode, await setResponse.Content.ReadAsStringAsync());
        }

        using (var repeat = ApiTestHelpers.Build(HttpMethod.Put, $"/api/v1/products/{productId}/color-barcodes/{blue}", csrf, new { barcode = blackCode }))
        using (var repeated = await fixture.Admin.SendAsync(repeat))
        {
            Assert.Equal(HttpStatusCode.Conflict, repeated.StatusCode);
            Assert.Contains($"Pantalón Zolo {suffix}", await repeated.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        // La caja recibe el código del color en cada talla de ese color.
        var snapshot = await GetAsync(fixture.Admin, "/api/v1/pos/snapshot");
        var rows = snapshot.GetProperty("variants").EnumerateArray().Where(row => row.GetProperty("productId").GetGuid() == productId).ToList();
        Assert.Equal(4, rows.Count);
        Assert.Equal(2, rows.Count(row => row.GetProperty("colorBarcode").GetString() == blackCode));
        Assert.Equal(2, rows.Count(row => row.GetProperty("colorBarcode").GetString() == blueCode));

        // Vacío lo quita.
        using var clear = ApiTestHelpers.Build(HttpMethod.Put, $"/api/v1/products/{productId}/color-barcodes/{blue}", csrf, new { barcode = string.Empty });
        using var cleared = await fixture.Admin.SendAsync(clear);
        var detail = await cleared.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Single(detail.GetProperty("colorBarcodes").EnumerateArray());
    }

    private async Task<object> ProductBodyAsync(string name, decimal price, int quantity, decimal? cost, Guid? partnerId, DateOnly? receivedOn)
    {
        async Task<Guid[]> Ids(string kind)
        {
            var page = await GetAsync(fixture.Admin, $"/api/v1/catalog/{kind}?pageSize=100");
            return page.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        }

        return new
        {
            name,
            categoryId = (await Ids("categories"))[0],
            brandId = (await Ids("brands"))[0],
            cutId = (Guid?)null,
            basePrice = price,
            receivedOn = receivedOn?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            variants = new[] { new { sizeId = (await Ids("sizes"))[0], colorId = (await Ids("colors"))[0], barcode = (string?)null, priceOverride = (decimal?)null, cost, initialQuantity = quantity, partnerId } },
        };
    }

    private async Task<JsonElement> CreateProductAsync(string name, decimal price, int quantity, decimal? cost, Guid? partnerId)
    {
        async Task<Guid[]> Ids(string kind)
        {
            var page = await GetAsync(fixture.Admin, $"/api/v1/catalog/{kind}?pageSize=100");
            return page.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        }

        return await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products", new
        {
            name,
            categoryId = (await Ids("categories"))[0],
            brandId = (await Ids("brands"))[0],
            cutId = (Guid?)null,
            basePrice = price,
            variants = new[] { new { sizeId = (await Ids("sizes"))[0], colorId = (await Ids("colors"))[0], barcode = (string?)null, priceOverride = (decimal?)null, cost, initialQuantity = quantity, partnerId } },
        }, HttpStatusCode.Created);
    }

    private async Task<Seller> CreateSellerAsync()
    {
        var roles = await GetAsync(fixture.Admin, "/api/v1/users/roles");
        var roleId = roles.EnumerateArray().Single(role => role.GetProperty("name").GetString() == "Vendedor").GetProperty("id").GetGuid();
        var username = string.Create(CultureInfo.InvariantCulture, $"vendedor.socio{Interlocked.Increment(ref _counter)}");
        _ = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/users",
            new { username, displayName = $"Vendedor {username}", password = CatalogApiFixture.DefaultPassword, roleIds = new[] { roleId } }, HttpStatusCode.Created);
        var client = fixture.CreateClient();
        return new Seller(client, await ApiTestHelpers.LoginAsync(client, username, CatalogApiFixture.DefaultPassword));
    }

    private static async Task<Guid> OpenCashAsync(Seller seller)
    {
        var registers = await GetAsync(seller.Client, "/api/v1/cash/registers");
        foreach (var register in registers.EnumerateArray().Where(register => register.GetProperty("openSession").ValueKind == JsonValueKind.Null))
        {
            var response = await PostRawAsync(seller.Client, seller.Csrf, "/api/v1/cash/sessions", new { registerId = register.GetProperty("id").GetGuid(), openingFloatNio = 0, openingFloatUsd = 0 });
            if (response.StatusCode == HttpStatusCode.Created)
            {
                return (await ReadAsync(response)).GetProperty("id").GetGuid();
            }
        }

        throw new InvalidOperationException("No hay una caja libre para la prueba.");
    }

    private static object SaleBody(Guid session, Guid variantId, int quantity, decimal price, object? discount, decimal paid, bool offline = false) =>
        new
        {
            clientSaleId = Guid.NewGuid(),
            cashSessionId = session,
            channel = "Store",
            createdAtUtc = DateTimeOffset.UtcNow,
            isOffline = offline,
            lines = new[] { new { variantId, quantity, unitPrice = price } },
            discount,
            discountApprovalId = (Guid?)null,
            payments = new[] { new { method = "Cash", currency = "NIO", amount = paid, exchangeRate = (decimal?)null, bank = (string?)null, reference = (string?)null } },
            note = (string?)null,
        };

    private static async Task<JsonElement> PostSaleAsync(Seller seller, Guid session, Guid variantId, int quantity, decimal price, object? discount, decimal paid) =>
        await PostAsync(seller.Client, seller.Csrf, "/api/v1/pos/sales", SaleBody(session, variantId, quantity, price, discount, paid), HttpStatusCode.Created);

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

    private static async Task<JsonElement> PutAsync(HttpClient client, string csrf, string url, object body)
    {
        using var request = ApiTestHelpers.Build(HttpMethod.Put, url, csrf, body);
        using var response = await client.SendAsync(request);
        Assert.True(response.IsSuccessStatusCode, $"PUT {url} → {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await ReadAsync(response);
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
}
