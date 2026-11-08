using LaGanga.Application.Identity;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Identity;

public sealed class IdentityBootstrapper(
    LaGangaDbContext dbContext,
    IPasswordService passwordService,
    TimeProvider timeProvider)
{
    public async Task<bool> CreateInitialAdministratorAsync(
        string username,
        string displayName,
        string password,
        CancellationToken cancellationToken)
    {
        if (await dbContext.Users.AnyAsync(cancellationToken))
        {
            return false;
        }

        var now = timeProvider.GetUtcNow();
        var user = new UserAccount(Guid.NewGuid(), username.Trim(), displayName.Trim(), now);
        user.SetPasswordHash(passwordService.HashPassword(user, password));

        var permissions = PermissionNames.All
            .Select(name => new PermissionGrant(Guid.NewGuid(), name))
            .ToArray();
        var administratorRole = new Role(Guid.NewGuid(), "Administrador");

        foreach (var permission in permissions)
        {
            administratorRole.AddPermission(permission);
        }

        user.AddRole(administratorRole);
        dbContext.Permissions.AddRange(permissions);
        dbContext.Roles.Add(administratorRole);
        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }
}
