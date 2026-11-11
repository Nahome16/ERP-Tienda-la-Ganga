using System.Net;
using System.Net.Http.Json;

namespace LaGanga.Api.Tests;

public sealed record RoleResponse(Guid Id, string Name, IReadOnlyList<string> Permissions);

public sealed record RoleReferenceResponse(Guid Id, string Name);

public sealed record UserResponse(
    Guid Id,
    string Username,
    string DisplayName,
    bool IsActive,
    IReadOnlyList<RoleReferenceResponse> Roles);

public sealed record MeResponse(Guid Id, string Username, IReadOnlyList<string> Roles, IReadOnlyList<string> Permissions);

public sealed class UserApiTests(CatalogApiFixture fixture) : IClassFixture<CatalogApiFixture>
{
    private const string NewPassword = "Otra-clave-segura-2026";
    private static readonly string[] SellerRole = ["Vendedor"];
    private static readonly string[] AdministratorRole = ["Administrador"];
    private static readonly string[] InventoryRole = ["Encargado de inventario"];
    private static readonly string[] ExpectedSellerPermissions = ["cash.operate", "catalog.read", "inventory.read", "product.read", "sale.create", "sale.exchange"];

    [PostgresFact]
    public async Task SystemRolesHaveTheirDocumentedPermissions()
    {
        var roles = await GetRolesAsync();

        var administrator = Assert.Single(roles, role => role.Name == "Administrador");
        var seller = Assert.Single(roles, role => role.Name == "Vendedor");
        var inventory = Assert.Single(roles, role => role.Name == "Encargado de inventario");
        Assert.Contains("user.manage", administrator.Permissions);
        Assert.Contains("inventory.cost.read", administrator.Permissions);
        Assert.Equal(ExpectedSellerPermissions, seller.Permissions);
        Assert.Contains("inventory.adjust", inventory.Permissions);
        Assert.DoesNotContain("inventory.cost.read", inventory.Permissions);
        Assert.DoesNotContain("user.manage", inventory.Permissions);
    }

    [PostgresFact]
    public async Task UserWithoutPermissionCannotManageAccounts()
    {
        using var response = await fixture.Reader.GetAsync(new Uri("/api/v1/users", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [PostgresFact]
    public async Task SellerCreatedByAdministratorCanReadButNotChangeOrSeeCosts()
    {
        await CreateUserAsync("vendedora.uno", "Vendedor");
        using var seller = fixture.CreateClient();
        var csrf = await ApiTestHelpers.LoginAsync(seller, "vendedora.uno", CatalogApiFixture.DefaultPassword);

        using var catalogs = await seller.GetAsync(new Uri("/api/v1/catalog/brands", UriKind.Relative));
        using var costs = await seller.GetAsync(new Uri("/api/v1/auth/permissions/inventory-cost", UriKind.Relative));
        using var createRequest = ApiTestHelpers.Build(
            HttpMethod.Post,
            "/api/v1/catalog/brands",
            csrf,
            new { name = "Marca de vendedora" });
        using var create = await seller.SendAsync(createRequest);
        using var users = await seller.GetAsync(new Uri("/api/v1/users", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, catalogs.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, costs.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, users.StatusCode);
    }

    [PostgresFact]
    public async Task DeactivatingAnAccountEndsItsSessionAndBlocksLogin()
    {
        var user = await CreateUserAsync("vendedor.temporal", "Vendedor");
        using var seller = fixture.CreateClient();
        await ApiTestHelpers.LoginAsync(seller, "vendedor.temporal", CatalogApiFixture.DefaultPassword);
        using var before = await seller.GetAsync(new Uri("/api/v1/auth/me", UriKind.Relative));

        using var deactivate = await UpdateUserAsync(user, isActive: false, roles: SellerRole);
        using var after = await seller.GetAsync(new Uri("/api/v1/auth/me", UriKind.Relative));
        using var loginAgain = fixture.CreateClient();
        using var loginRequest = ApiTestHelpers.Build(
            HttpMethod.Post,
            "/api/v1/auth/login",
            null,
            new { username = "vendedor.temporal", password = CatalogApiFixture.DefaultPassword });
        using var login = await loginAgain.SendAsync(loginRequest);

        Assert.Equal(HttpStatusCode.OK, before.StatusCode);
        Assert.Equal(HttpStatusCode.OK, deactivate.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [PostgresFact]
    public async Task RoleChangesApplyToTheNextRequest()
    {
        var user = await CreateUserAsync("inventario.uno", "Vendedor");
        using var client = fixture.CreateClient();
        await ApiTestHelpers.LoginAsync(client, "inventario.uno", CatalogApiFixture.DefaultPassword);

        using var update = await UpdateUserAsync(user, isActive: true, roles: InventoryRole);
        var me = await client.GetFromJsonAsync<MeResponse>(new Uri("/api/v1/auth/me", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        Assert.Equal(InventoryRole, me!.Roles);
        Assert.Contains("catalog.manage", me.Permissions);
    }

    [PostgresFact]
    public async Task AdministratorCannotDeactivateOrDemoteThemselves()
    {
        var me = await fixture.Admin.GetFromJsonAsync<MeResponse>(new Uri("/api/v1/auth/me", UriKind.Relative));
        var self = new UserResponse(me!.Id, me.Username, "Administración de pruebas", true, []);

        using var deactivate = await UpdateUserAsync(self, isActive: false, roles: AdministratorRole);
        using var demote = await UpdateUserAsync(self, isActive: true, roles: SellerRole);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, deactivate.StatusCode);
        Assert.Equal("cannot_deactivate_self", await ApiTestHelpers.ReadProblemCodeAsync(deactivate));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, demote.StatusCode);
        Assert.Equal("cannot_remove_own_admin", await ApiTestHelpers.ReadProblemCodeAsync(demote));
    }

    [PostgresFact]
    public async Task InvalidAccountsAreRejected()
    {
        var roles = await GetRolesAsync();
        var sellerId = roles.Single(role => role.Name == "Vendedor").Id;
        await CreateUserAsync("repetido", "Vendedor");

        using var duplicate = await PostUserAsync(new
        {
            username = "REPETIDO",
            displayName = "Otra persona",
            password = CatalogApiFixture.DefaultPassword,
            roleIds = new[] { sellerId },
        });
        using var shortPassword = await PostUserAsync(new
        {
            username = "clave.corta",
            displayName = "Clave corta",
            password = "corta",
            roleIds = new[] { sellerId },
        });
        using var withoutRoles = await PostUserAsync(new
        {
            username = "sin.rol",
            displayName = "Sin rol",
            password = CatalogApiFixture.DefaultPassword,
            roleIds = Array.Empty<Guid>(),
        });
        using var invalidUsername = await PostUserAsync(new
        {
            username = "con espacio",
            displayName = "Usuario inválido",
            password = CatalogApiFixture.DefaultPassword,
            roleIds = new[] { sellerId },
        });

        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, shortPassword.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, withoutRoles.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalidUsername.StatusCode);
    }

    [PostgresFact]
    public async Task PasswordResetEndsSessionsAndAcceptsTheNewPassword()
    {
        var user = await CreateUserAsync("cajera.dos", "Vendedor");
        using var seller = fixture.CreateClient();
        await ApiTestHelpers.LoginAsync(seller, "cajera.dos", CatalogApiFixture.DefaultPassword);

        using var resetRequest = ApiTestHelpers.Build(
            HttpMethod.Post,
            $"/api/v1/users/{user.Id}/password",
            fixture.AdminCsrf,
            new { password = NewPassword });
        using var reset = await fixture.Admin.SendAsync(resetRequest);
        using var after = await seller.GetAsync(new Uri("/api/v1/auth/me", UriKind.Relative));
        using var fresh = fixture.CreateClient();
        await ApiTestHelpers.LoginAsync(fresh, "cajera.dos", NewPassword);

        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    private async Task<IReadOnlyList<RoleResponse>> GetRolesAsync() =>
        (await fixture.Admin.GetFromJsonAsync<IReadOnlyList<RoleResponse>>(
            new Uri("/api/v1/users/roles", UriKind.Relative)))!;

    private async Task<HttpResponseMessage> PostUserAsync(object body)
    {
        using var request = ApiTestHelpers.Build(HttpMethod.Post, "/api/v1/users", fixture.AdminCsrf, body);
        return await fixture.Admin.SendAsync(request);
    }

    private async Task<UserResponse> CreateUserAsync(string username, string roleName)
    {
        var roles = await GetRolesAsync();
        var roleId = roles.Single(role => role.Name == roleName).Id;
        using var response = await PostUserAsync(new
        {
            username,
            displayName = $"Persona {username}",
            password = CatalogApiFixture.DefaultPassword,
            roleIds = new[] { roleId },
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserResponse>())!;
    }

    private async Task<HttpResponseMessage> UpdateUserAsync(UserResponse user, bool isActive, IReadOnlyList<string> roles)
    {
        var allRoles = await GetRolesAsync();
        var roleIds = allRoles.Where(role => roles.Contains(role.Name)).Select(role => role.Id).ToArray();
        using var request = ApiTestHelpers.Build(
            HttpMethod.Put,
            $"/api/v1/users/{user.Id}",
            fixture.AdminCsrf,
            new { displayName = user.DisplayName, roleIds, isActive });
        return await fixture.Admin.SendAsync(request);
    }
}
