using LaGanga.Domain.Identity;

namespace LaGanga.Domain.Tests;

public sealed class IdentityTests
{
    [Fact]
    public void UsernameNormalizationTrimsAndIgnoresLetterCase()
    {
        var normalized = UserAccount.NormalizeUsername("  vendedora.1  ");

        Assert.Equal("VENDEDORA.1", normalized);
    }

    [Fact]
    public void SessionStopsBeingValidWhenIdleTimeoutIsReached()
    {
        var createdAt = new DateTimeOffset(2026, 11, 8, 14, 0, 0, TimeSpan.Zero);
        var session = new UserSession(
            Guid.NewGuid(),
            Guid.NewGuid(),
            "token-id",
            new string('A', 64),
            createdAt,
            createdAt.AddHours(8));

        Assert.True(session.IsValidAt(createdAt.AddMinutes(29), TimeSpan.FromMinutes(30)));
        Assert.False(session.IsValidAt(createdAt.AddMinutes(30), TimeSpan.FromMinutes(30)));
    }

    [Fact]
    public void RevokedSessionCannotBeUsedAgain()
    {
        var createdAt = new DateTimeOffset(2026, 11, 8, 14, 0, 0, TimeSpan.Zero);
        var session = new UserSession(
            Guid.NewGuid(),
            Guid.NewGuid(),
            "token-id",
            new string('A', 64),
            createdAt,
            createdAt.AddHours(8));

        session.Revoke(createdAt.AddMinutes(5), "user_logout");

        Assert.False(session.IsValidAt(createdAt.AddMinutes(6), TimeSpan.FromMinutes(30)));
        Assert.Equal("user_logout", session.RevokedReason);
    }

    [Fact]
    public void AdministratorAlwaysReceivesEverySystemPermission()
    {
        var permissions = SystemRoles.ResolvePermissions(
            [SystemRoles.Administrator],
            [PermissionNames.CatalogRead]);

        Assert.Equal(PermissionNames.All.Order(StringComparer.Ordinal), permissions);
        Assert.Contains(PermissionNames.SaleRead, permissions);
        Assert.Contains(PermissionNames.CashReportRead, permissions);
        Assert.Contains(PermissionNames.InventoryKardexRead, permissions);
        Assert.Contains(PermissionNames.UserManage, permissions);
        Assert.Contains(PermissionNames.AuditRead, permissions);
        Assert.Contains(PermissionNames.InvestmentRead, permissions);
    }

    [Fact]
    public void NonAdministratorKeepsOnlyAssignedPermissions()
    {
        var permissions = SystemRoles.ResolvePermissions(
            [SystemRoles.Seller],
            [PermissionNames.CatalogRead, PermissionNames.SaleCreate]);

        Assert.Equal(
            new[] { PermissionNames.CatalogRead, PermissionNames.SaleCreate }.Order(StringComparer.Ordinal),
            permissions);
        Assert.DoesNotContain(PermissionNames.CashReportRead, permissions);
    }
}
