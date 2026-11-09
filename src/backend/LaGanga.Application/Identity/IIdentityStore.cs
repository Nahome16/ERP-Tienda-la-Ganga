using LaGanga.Domain.Identity;

namespace LaGanga.Application.Identity;

public interface IIdentityStore
{
    Task<UserAccount?> FindUserByNormalizedUsernameAsync(
        string normalizedUsername,
        CancellationToken cancellationToken);

    Task<UserAccount?> FindUserByNormalizedEmailAsync(
        string normalizedEmail,
        CancellationToken cancellationToken);

    Task<UserSession?> FindSessionAsync(Guid sessionId, CancellationToken cancellationToken);

    void AddSession(UserSession session);

    Task SaveChangesAsync(CancellationToken cancellationToken);
}
