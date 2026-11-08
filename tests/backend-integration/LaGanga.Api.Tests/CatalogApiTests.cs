using System.Net;
using System.Net.Http.Json;

namespace LaGanga.Api.Tests;

public sealed class CatalogApiTests(CatalogApiFixture fixture) : IClassFixture<CatalogApiFixture>
{
    [PostgresFact]
    public async Task AnonymousUserCannotReadCatalogs()
    {
        using var response = await fixture.Anonymous.GetAsync(new Uri("/api/v1/catalog/brands", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [PostgresFact]
    public async Task InitialCatalogsAreAvailable()
    {
        var brands = await ListAsync(fixture.Admin, "brands", "search=sin%20marca");
        var sizes = await ListAsync(fixture.Admin, "sizes", "pageSize=100");
        var categories = await ListAsync(fixture.Admin, "categories", "pageSize=100");

        Assert.Contains(brands.Items, brand => brand.Name == "Sin marca");
        Assert.Contains(sizes.Items, size => size.Name == "1XL");
        var dama = Assert.Single(categories.Items, category => category.Name == "Dama");
        Assert.Contains(categories.Items, category => category.Name == "Pantalones" && category.ParentId == dama.Id);
    }

    [PostgresFact]
    public async Task ReaderCanListButCannotCreate()
    {
        var page = await ListAsync(fixture.Reader, "colors", null);
        using var request = ApiTestHelpers.Build(
            HttpMethod.Post,
            "/api/v1/catalog/colors",
            fixture.ReaderCsrf,
            new { name = "Vino" });
        using var response = await fixture.Reader.SendAsync(request);

        Assert.NotEmpty(page.Items);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [PostgresFact]
    public async Task CreatingWithoutCsrfTokenIsRejected()
    {
        using var request = ApiTestHelpers.Build(
            HttpMethod.Post,
            "/api/v1/catalog/brands",
            null,
            new { name = "Marca sin token" });
        using var response = await fixture.Admin.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("invalid_csrf", await ApiTestHelpers.ReadProblemCodeAsync(response));
    }

    [PostgresFact]
    public async Task DuplicateNameIgnoringCaseAndSpacesIsRejected()
    {
        var created = await CreateAsync("brands", new { name = "Denim  Nueva" });
        using var request = ApiTestHelpers.Build(
            HttpMethod.Post,
            "/api/v1/catalog/brands",
            fixture.AdminCsrf,
            new { name = "  denim nueva " });
        using var duplicate = await fixture.Admin.SendAsync(request);

        Assert.Equal("Denim Nueva", created.Name);
        Assert.Equal(1, created.Version);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Equal("duplicate_name", await ApiTestHelpers.ReadProblemCodeAsync(duplicate));
    }

    [PostgresFact]
    public async Task StaleVersionCannotOverwriteAnotherEdit()
    {
        var color = await CreateAsync("colors", new { name = "Mostaza", swatchHex = "#c9a227" });

        using var firstRequest = ApiTestHelpers.Build(
            HttpMethod.Put,
            $"/api/v1/catalog/colors/{color.Id}",
            fixture.AdminCsrf,
            new { name = "Mostaza", swatchHex = "#D4A017", sortOrder = color.SortOrder },
            color.Version);
        using var first = await fixture.Admin.SendAsync(firstRequest);
        var updated = await first.Content.ReadFromJsonAsync<CatalogItemResponse>();

        using var staleRequest = ApiTestHelpers.Build(
            HttpMethod.Put,
            $"/api/v1/catalog/colors/{color.Id}",
            fixture.AdminCsrf,
            new { name = "Mostaza oscuro", sortOrder = color.SortOrder },
            color.Version);
        using var stale = await fixture.Admin.SendAsync(staleRequest);

        Assert.Equal("#C9A227", color.SwatchHex);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(2, updated!.Version);
        Assert.Equal("#D4A017", updated.SwatchHex);
        Assert.Equal("\"2\"", first.Headers.ETag?.Tag);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("version_conflict", await ApiTestHelpers.ReadProblemCodeAsync(stale));
    }

    [PostgresFact]
    public async Task UpdateWithoutIfMatchRequiresVersion()
    {
        var cut = await CreateAsync("cuts", new { name = "Bootcut" });
        using var request = ApiTestHelpers.Build(
            HttpMethod.Put,
            $"/api/v1/catalog/cuts/{cut.Id}",
            fixture.AdminCsrf,
            new { name = "Boot cut" });
        using var response = await fixture.Admin.SendAsync(request);

        Assert.Equal(HttpStatusCode.PreconditionRequired, response.StatusCode);
    }

    [PostgresFact]
    public async Task InvalidSwatchIsRejected()
    {
        using var request = ApiTestHelpers.Build(
            HttpMethod.Post,
            "/api/v1/catalog/colors",
            fixture.AdminCsrf,
            new { name = "Turquesa", swatchHex = "turquesa" });
        using var response = await fixture.Admin.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [PostgresFact]
    public async Task CategoryCannotMoveUnderItsOwnDescendant()
    {
        var root = await CreateAsync("categories", new { name = "Accesorios prueba" });
        var child = await CreateAsync("categories", new { name = "Fajas", parentId = root.Id });

        using var request = ApiTestHelpers.Build(
            HttpMethod.Put,
            $"/api/v1/catalog/categories/{root.Id}",
            fixture.AdminCsrf,
            new { name = root.Name, parentId = child.Id, sortOrder = root.SortOrder },
            root.Version);
        using var response = await fixture.Admin.SendAsync(request);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("category_cycle", await ApiTestHelpers.ReadProblemCodeAsync(response));
    }

    [PostgresFact]
    public async Task SameNameIsAllowedUnderDifferentParentsButNotTwiceAtRoot()
    {
        var first = await CreateAsync("categories", new { name = "Temporada prueba" });
        var second = await CreateAsync("categories", new { name = "Ofertas prueba" });
        await CreateAsync("categories", new { name = "Shorts", parentId = first.Id });
        await CreateAsync("categories", new { name = "Shorts", parentId = second.Id });

        using var request = ApiTestHelpers.Build(
            HttpMethod.Post,
            "/api/v1/catalog/categories",
            fixture.AdminCsrf,
            new { name = "temporada PRUEBA" });
        using var duplicateRoot = await fixture.Admin.SendAsync(request);

        Assert.Equal(HttpStatusCode.Conflict, duplicateRoot.StatusCode);
    }

    [PostgresFact]
    public async Task CategoryWithActiveChildrenCannotBeInactivated()
    {
        var root = await CreateAsync("categories", new { name = "Calzado prueba" });
        var child = await CreateAsync("categories", new { name = "Sandalias", parentId = root.Id });

        using var blockedRequest = ApiTestHelpers.Build(
            HttpMethod.Post,
            $"/api/v1/catalog/categories/{root.Id}/inactivate",
            fixture.AdminCsrf,
            ifMatch: root.Version);
        using var blocked = await fixture.Admin.SendAsync(blockedRequest);

        using var childRequest = ApiTestHelpers.Build(
            HttpMethod.Post,
            $"/api/v1/catalog/categories/{child.Id}/inactivate",
            fixture.AdminCsrf,
            ifMatch: child.Version);
        using var childResponse = await fixture.Admin.SendAsync(childRequest);

        using var rootRequest = ApiTestHelpers.Build(
            HttpMethod.Post,
            $"/api/v1/catalog/categories/{root.Id}/inactivate",
            fixture.AdminCsrf,
            ifMatch: root.Version);
        using var rootResponse = await fixture.Admin.SendAsync(rootRequest);
        var inactiveRoot = await rootResponse.Content.ReadFromJsonAsync<CatalogItemResponse>();

        Assert.Equal(HttpStatusCode.UnprocessableEntity, blocked.StatusCode);
        Assert.Equal("category_has_active_children", await ApiTestHelpers.ReadProblemCodeAsync(blocked));
        Assert.Equal(HttpStatusCode.OK, childResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, rootResponse.StatusCode);
        Assert.False(inactiveRoot!.IsActive);

        var activeList = await ListAsync(fixture.Admin, "categories", "search=calzado%20prueba");
        var allList = await ListAsync(fixture.Admin, "categories", "search=calzado%20prueba&status=all");
        Assert.Empty(activeList.Items);
        Assert.Single(allList.Items);
    }

    private async Task<CatalogItemResponse> CreateAsync(string segment, object body)
    {
        using var request = ApiTestHelpers.Build(
            HttpMethod.Post,
            $"/api/v1/catalog/{segment}",
            fixture.AdminCsrf,
            body);
        using var response = await fixture.Admin.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CatalogItemResponse>())!;
    }

    private static async Task<CatalogPageResponse> ListAsync(HttpClient client, string segment, string? query)
    {
        var url = query is null ? $"/api/v1/catalog/{segment}" : $"/api/v1/catalog/{segment}?{query}";
        using var response = await client.GetAsync(new Uri(url, UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CatalogPageResponse>())!;
    }
}
