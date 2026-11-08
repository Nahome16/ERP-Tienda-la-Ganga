using LaGanga.Application.Identity;
using LaGanga.Domain.Identity;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Persistence;

public sealed class IdentityStore(LaGangaDbContext dbContext) : IIdentityStore
{
    public Task<UserAccount?> FindUserByNormalizedUsernameAsync(
        string normalizedUsername,
        CancellationToken cancellationToken) =>
        dbContext.Users
            .Include(user => user.Roles)
                .ThenInclude(userRole => userRole.Role)
                    .ThenInclude(role => role.Permissions)
                        .ThenInclude(rolePermission => rolePermission.Permission)
            .SingleOrDefaultAsync(
                user => user.NormalizedUsername == normalizedUsername,
                cancellationToken);

    public Task<UserSession?> FindSessionAsync(Guid sessionId, CancellationToken cancellationToken) =>
        dbContext.Sessions
            .Include(session => session.User)
                .ThenInclude(user => user.Roles)
                    .ThenInclude(userRole => userRole.Role)
                        .ThenInclude(role => role.Permissions)
                            .ThenInclude(rolePermission => rolePermission.Permission)
            .SingleOrDefaultAsync(session => session.Id == sessionId, cancellationToken);

    public void AddSession(UserSession session) => dbContext.Sessions.Add(session);

    public async Task SaveChangesAsync(CancellationToken cancellationToken) =>
        await dbContext.SaveChangesAsync(cancellationToken);
}
