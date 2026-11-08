using LaGanga.Application.Identity;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Identity;

public sealed class IdentityBootstrapper(
    LaGangaDbContext dbContext,
    IPasswordService passwordService,
    RoleSynchronizer roleSynchronizer,
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

        await roleSynchronizer.SynchronizeAsync(cancellationToken);
        var administratorRole = await dbContext.Roles
            .SingleAsync(role => role.Name == SystemRoles.Administrator, cancellationToken);

        var user = new UserAccount(Guid.NewGuid(), username.Trim(), displayName.Trim(), timeProvider.GetUtcNow());
        user.SetPasswordHash(passwordService.HashPassword(user, password));
        user.AddRole(administratorRole);
        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }
}
