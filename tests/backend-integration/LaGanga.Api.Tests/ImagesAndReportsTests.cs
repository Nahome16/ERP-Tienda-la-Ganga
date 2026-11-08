using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;

namespace LaGanga.Api.Tests;

/// <summary>Imágenes de productos y reportes en Excel.</summary>
public sealed class ImagesAndReportsTests(CatalogApiFixture fixture) : IClassFixture<CatalogApiFixture>
{
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 1, 2, 3, 4, 5, 6, 7, 8];
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82];
    private static int _counter;

    [PostgresFact]
    public async Task ProductImagesAreStoredOrderedServedAndLimitedToFour()
    {
        var productId = await CreateProductAsync("Blusa con fotos");
        var first = await UploadAsync(fixture.Admin, fixture.AdminCsrf, productId, Jpeg, Jpeg);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var firstImage = await ReadAsync(first);
        Assert.True(firstImage.GetProperty("isPrimary").GetBoolean());
        Assert.StartsWith("/api/v1/media/", firstImage.GetProperty("thumbUrl").GetString(), StringComparison.Ordinal);

        var ids = new List<Guid> { firstImage.GetProperty("id").GetGuid() };
        for (var index = 0; index < 3; index++)
        {
            var response = await UploadAsync(fixture.Admin, fixture.AdminCsrf, productId, Png, Jpeg);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            ids.Add((await ReadAsync(response)).GetProperty("id").GetGuid());
        }

        var fifth = await UploadAsync(fixture.Admin, fixture.AdminCsrf, productId, Jpeg, Jpeg);
        Assert.Equal(HttpStatusCode.Conflict, fifth.StatusCode);
        Assert.Equal("image_limit", await ApiTestHelpers.ReadProblemCodeAsync(fifth));

        var media = await fixture.Admin.GetAsync(new Uri(firstImage.GetProperty("url").GetString()!, UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, media.StatusCode);
        Assert.Equal("image/jpeg", media.Content.Headers.ContentType?.MediaType);
        Assert.Contains("immutable", media.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal(Jpeg, await media.Content.ReadAsByteArrayAsync());
        var anonymous = await fixture.Anonymous.GetAsync(new Uri(firstImage.GetProperty("url").GetString()!, UriKind.Relative));
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        var traversal = await fixture.Admin.GetAsync(new Uri("/api/v1/media/..%2f..%2fappsettings.json", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, traversal.StatusCode);

        // Reordenar: la última pasa a ser la principal.
        var reordered = ids.AsEnumerable().Reverse().ToArray();
        var order = await PutAsync(fixture.Admin, fixture.AdminCsrf, $"/api/v1/products/{productId}/images/order", new { imageIds = reordered });
        Assert.Equal(reordered[0], order[0].GetProperty("id").GetGuid());
        Assert.True(order[0].GetProperty("isPrimary").GetBoolean());
        var badOrder = await PutRawAsync(fixture.Admin, fixture.AdminCsrf, $"/api/v1/products/{productId}/images/order", new { imageIds = new[] { reordered[0] } });
        Assert.Equal(HttpStatusCode.BadRequest, badOrder.StatusCode);

        var detail = await GetAsync(fixture.Admin, $"/api/v1/products/{productId}");
        Assert.Equal(4, detail.GetProperty("images").GetArrayLength());
        Assert.Equal(order[0].GetProperty("thumbUrl").GetString(), detail.GetProperty("primaryImageUrl").GetString());
        var list = await GetAsync(fixture.Admin, $"/api/v1/products?search={Uri.EscapeDataString("Blusa con fotos")}");
        Assert.Equal(order[0].GetProperty("thumbUrl").GetString(), list.GetProperty("items")[0].GetProperty("primaryImageUrl").GetString());
        var snapshot = await GetAsync(fixture.Admin, "/api/v1/pos/snapshot");
        Assert.Contains(snapshot.GetProperty("variants").EnumerateArray(), variant =>
            variant.GetProperty("productId").GetGuid() == productId && variant.GetProperty("imageUrl").GetString() == order[0].GetProperty("thumbUrl").GetString());

        using var delete = ApiTestHelpers.Build(HttpMethod.Delete, $"/api/v1/products/{productId}/images/{reordered[0]}", fixture.AdminCsrf);
        Assert.Equal(HttpStatusCode.NoContent, (await fixture.Admin.SendAsync(delete)).StatusCode);
        var after = await GetAsync(fixture.Admin, $"/api/v1/products/{productId}");
        Assert.Equal(3, after.GetProperty("images").GetArrayLength());
        Assert.True(after.GetProperty("images")[0].GetProperty("isPrimary").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await fixture.Admin.GetAsync(new Uri(order[0].GetProperty("url").GetString()!, UriKind.Relative))).StatusCode);
    }

    [PostgresFact]
    public async Task InvalidImagesAndMissingPermissionAreRejected()
    {
        var productId = await CreateProductAsync("Camisa sin fotos");
        var notImage = await UploadAsync(fixture.Admin, fixture.AdminCsrf, productId, "esto no es una imagen"u8.ToArray(), Jpeg);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, notImage.StatusCode);
        Assert.Equal("invalid_image", await ApiTestHelpers.ReadProblemCodeAsync(notImage));
        var huge = await UploadAsync(fixture.Admin, fixture.AdminCsrf, productId, [.. Jpeg, .. new byte[3_000_000]], Jpeg);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, huge.StatusCode);
        var noThumb = await fixture.Admin.SendAsync(BuildUpload(fixture.AdminCsrf, productId, Jpeg, null));
        Assert.Equal(HttpStatusCode.BadRequest, noThumb.StatusCode);
        var unknown = await UploadAsync(fixture.Admin, fixture.AdminCsrf, Guid.NewGuid(), Jpeg, Jpeg);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);

        var roles = await GetAsync(fixture.Admin, "/api/v1/users/roles");
        var roleId = roles.EnumerateArray().Single(role => role.GetProperty("name").GetString() == "Vendedor").GetProperty("id").GetGuid();
        var username = string.Create(CultureInfo.InvariantCulture, $"vendedor.img{Interlocked.Increment(ref _counter)}");
        using var create = ApiTestHelpers.Build(HttpMethod.Post, "/api/v1/users", fixture.AdminCsrf,
            new { username, displayName = "Vendedor imágenes", password = CatalogApiFixture.DefaultPassword, roleIds = new[] { roleId } });
        Assert.Equal(HttpStatusCode.Created, (await fixture.Admin.SendAsync(create)).StatusCode);
        using var seller = fixture.CreateClient();
        var csrf = await ApiTestHelpers.LoginAsync(seller, username, CatalogApiFixture.DefaultPassword);
        var forbidden = await UploadAsync(seller, csrf, productId, Jpeg, Jpeg);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        var noCsrf = await fixture.Admin.SendAsync(BuildUpload(null, productId, Jpeg, Jpeg));
        Assert.Equal(HttpStatusCode.Forbidden, noCsrf.StatusCode);
    }

    [PostgresFact]
    public async Task ExcelReportsDownloadWithTheRightSheetsTotalsAndPermissions()
    {
        var productId = await CreateProductAsync("Jeans para reporte", quantity: 10, cost: 300m);
        var product = await GetAsync(fixture.Admin, $"/api/v1/products/{productId}");
        var variantId = product.GetProperty("variants")[0].GetProperty("id").GetGuid();

        var roles = await GetAsync(fixture.Admin, "/api/v1/users/roles");
        var roleId = roles.EnumerateArray().Single(role => role.GetProperty("name").GetString() == "Vendedor").GetProperty("id").GetGuid();
        var username = string.Create(CultureInfo.InvariantCulture, $"vendedor.rep{Interlocked.Increment(ref _counter)}");
        using var create = ApiTestHelpers.Build(HttpMethod.Post, "/api/v1/users", fixture.AdminCsrf,
            new { username, displayName = "Vendedor reportes", password = CatalogApiFixture.DefaultPassword, roleIds = new[] { roleId } });
        Assert.Equal(HttpStatusCode.Created, (await fixture.Admin.SendAsync(create)).StatusCode);
        using var seller = fixture.CreateClient();
        var csrf = await ApiTestHelpers.LoginAsync(seller, username, CatalogApiFixture.DefaultPassword);
        var registers = await GetAsync(seller, "/api/v1/cash/registers");
        var register = registers.EnumerateArray().First(item => item.GetProperty("openSession").ValueKind == JsonValueKind.Null);
        var session = await PostAsync(seller, csrf, "/api/v1/cash/sessions", new { registerId = register.GetProperty("id").GetGuid(), openingFloatNio = 100, openingFloatUsd = 0 }, HttpStatusCode.Created);
        var sessionId = session.GetProperty("id").GetGuid();
        var sale = await PostAsync(seller, csrf, "/api/v1/pos/sales", new
        {
            clientSaleId = Guid.NewGuid(),
            cashSessionId = sessionId,
            channel = "WhatsApp",
            createdAtUtc = DateTimeOffset.UtcNow,
            isOffline = false,
            lines = new[] { new { variantId, quantity = 2, unitPrice = 500m } },
            discount = new { type = "Amount", value = 100m },
            discountApprovalId = (Guid?)null,
            payments = new[] { new { method = "Transfer", currency = "NIO", amount = 900m, exchangeRate = (decimal?)null, bank = "BAC", reference = "123" } },
            note = (string?)null,
        }, HttpStatusCode.Created);
        Assert.Equal(900m, sale.GetProperty("sale").GetProperty("totalNio").GetDecimal());

        var today = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(-6)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var salesFile = await DownloadAsync(fixture.Admin, $"/api/v1/reports/sales?from={today}&to={today}");
        Assert.Contains("ventas_", salesFile.FileName, StringComparison.Ordinal);
        using (var workbook = new XLWorkbook(new MemoryStream(salesFile.Bytes)))
        {
            Assert.Equal(["Resumen", "Ventas", "Detalle", "Pagos"], workbook.Worksheets.Select(sheet => sheet.Name).ToArray());
            var summary = workbook.Worksheet("Resumen");
            var total = summary.CellsUsed().First(cell => cell.GetString() == "TOTAL VENDIDO C$").CellRight().GetDouble();
            Assert.True(total >= 900);
            Assert.Contains(workbook.Worksheet("Ventas").CellsUsed(), cell => cell.GetString().StartsWith("V-", StringComparison.Ordinal));
            Assert.Contains(workbook.Worksheet("Detalle").CellsUsed(), cell => cell.GetString().Contains("Jeans para reporte", StringComparison.Ordinal));
            Assert.Contains(workbook.Worksheet("Pagos").CellsUsed(), cell => cell.GetString() == "BAC");
        }

        var adminStock = await DownloadAsync(fixture.Admin, "/api/v1/reports/inventory");
        using (var workbook = new XLWorkbook(new MemoryStream(adminStock.Bytes)))
        {
            Assert.Contains(workbook.Worksheet("Existencias").CellsUsed(), cell => cell.GetString() == "Costo C$");
        }

        var sellerStock = await DownloadAsync(seller, "/api/v1/reports/inventory");
        using (var workbook = new XLWorkbook(new MemoryStream(sellerStock.Bytes)))
        {
            Assert.DoesNotContain(workbook.Worksheet("Existencias").CellsUsed(), cell => cell.GetString().Contains("Costo", StringComparison.Ordinal));
        }

        var movements = await DownloadAsync(fixture.Admin, $"/api/v1/reports/movements?from={today}&to={today}");
        using (var workbook = new XLWorkbook(new MemoryStream(movements.Bytes)))
        {
            var types = workbook.Worksheet("Movimientos").CellsUsed().Select(cell => cell.GetString()).ToArray();
            Assert.Contains("Venta", types);
            Assert.Contains("Existencia inicial", types);
        }

        _ = await PostAsync(seller, csrf, $"/api/v1/cash/sessions/{sessionId}/close", new { countedCashNio = 100m, countedCashUsd = 0m });
        var cashFile = await DownloadAsync(fixture.Admin, $"/api/v1/reports/cash?from={today}&to={today}");
        using (var workbook = new XLWorkbook(new MemoryStream(cashFile.Bytes)))
        {
            Assert.Equal(["Cierres por caja", "Consolidado por día", "Transferencias por banco"], workbook.Worksheets.Select(sheet => sheet.Name).ToArray());
            Assert.Contains(workbook.Worksheet("Transferencias por banco").CellsUsed(), cell => cell.GetString() == "BAC");
        }

        Assert.Equal(HttpStatusCode.Forbidden, (await seller.GetAsync(new Uri("/api/v1/reports/sales", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await seller.GetAsync(new Uri("/api/v1/reports/cash", UriKind.Relative))).StatusCode);
        var backwards = await fixture.Admin.GetAsync(new Uri($"/api/v1/reports/sales?from={today}&to=2020-01-01", UriKind.Relative));
        Assert.Equal(HttpStatusCode.BadRequest, backwards.StatusCode);
        var tooLong = await fixture.Admin.GetAsync(new Uri("/api/v1/reports/sales?from=2024-01-01&to=2026-01-01", UriKind.Relative));
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
    }

    // ---------------------------------------------------------------- ayudas

    private async Task<Guid> CreateProductAsync(string name, int quantity = 3, decimal? cost = null)
    {
        async Task<Guid[]> Ids(string kind)
        {
            var page = await GetAsync(fixture.Admin, $"/api/v1/catalog/{kind}?pageSize=100");
            return page.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        }

        var suffix = Interlocked.Increment(ref _counter);
        var product = await PostAsync(fixture.Admin, fixture.AdminCsrf, "/api/v1/products", new
        {
            name = $"{name} {suffix}",
            categoryId = (await Ids("categories"))[0],
            brandId = (await Ids("brands"))[0],
            cutId = (Guid?)null,
            basePrice = 500m,
            variants = new[] { new { sizeId = (await Ids("sizes"))[0], colorId = (await Ids("colors"))[0], barcode = (string?)null, priceOverride = (decimal?)null, cost, initialQuantity = quantity } },
        }, HttpStatusCode.Created);
        return product.GetProperty("id").GetGuid();
    }

    private static HttpRequestMessage BuildUpload(string? csrf, Guid productId, byte[] file, byte[]? thumb)
    {
        var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(file), "file", "foto.jpg");
        if (thumb is not null)
        {
            form.Add(new ByteArrayContent(thumb), "thumb", "foto_t.jpg");
        }

        var request = new HttpRequestMessage(HttpMethod.Post, new Uri($"/api/v1/products/{productId}/images", UriKind.Relative)) { Content = form };
        if (csrf is not null)
        {
            request.Headers.Add("X-CSRF-Token", csrf);
        }

        return request;
    }

    private static async Task<HttpResponseMessage> UploadAsync(HttpClient client, string csrf, Guid productId, byte[] file, byte[] thumb)
    {
        using var request = BuildUpload(csrf, productId, file, thumb);
        return await client.SendAsync(request);
    }

    private static async Task<(string FileName, byte[] Bytes)> DownloadAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(new Uri(url, UriKind.Relative));
        Assert.True(response.IsSuccessStatusCode, $"GET {url} → {(int)response.StatusCode}");
        Assert.Equal(XlsxType, response.Content.Headers.ContentType?.MediaType);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal((byte)'P', bytes[0]);
        Assert.Equal((byte)'K', bytes[1]);
        return (response.Content.Headers.ContentDisposition?.FileNameStar ?? response.Content.Headers.ContentDisposition?.FileName ?? string.Empty, bytes);
    }

    private static async Task<JsonElement> GetAsync(HttpClient client, string url)
    {
        using var response = await client.GetAsync(new Uri(url, UriKind.Relative));
        Assert.True(response.IsSuccessStatusCode, $"GET {url} → {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await ReadAsync(response);
    }

    private static async Task<JsonElement> PostAsync(HttpClient client, string csrf, string url, object body, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using var request = ApiTestHelpers.Build(HttpMethod.Post, url, csrf, body);
        using var response = await client.SendAsync(request);
        Assert.True(response.StatusCode == expected, $"POST {url} → {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await ReadAsync(response);
    }

    private static async Task<HttpResponseMessage> PutRawAsync(HttpClient client, string csrf, string url, object body)
    {
        using var request = ApiTestHelpers.Build(HttpMethod.Put, url, csrf, body);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement[]> PutAsync(HttpClient client, string csrf, string url, object body)
    {
        using var response = await PutRawAsync(client, csrf, url, body);
        Assert.True(response.IsSuccessStatusCode, $"PUT {url} → {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await ReadAsync(response)).EnumerateArray().ToArray();
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
}
