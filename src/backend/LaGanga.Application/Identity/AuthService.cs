using System.Security.Cryptography;
using System.Text;
using LaGanga.Domain.Identity;

namespace LaGanga.Application.Identity;

public sealed class AuthService(
    IIdentityStore identityStore,
    IPasswordService passwordService,
    AuthenticationSettings settings,
    TimeProvider timeProvider)
{
    public async Task<LoginResult> LoginAsync(
        LoginCommand command,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command.Username) ||
            command.Username.Length > 254 ||
            string.IsNullOrWhiteSpace(command.Password) ||
            command.Password.Length > 256)
        {
            return LoginResult.Invalid(LoginFailure.InvalidRequest);
        }

        var login = command.Username.Trim();
        var user = login.Contains('@', StringComparison.Ordinal)
            ? await identityStore.FindUserByNormalizedEmailAsync(UserAccount.NormalizeEmail(login), cancellationToken)
            : await identityStore.FindUserByNormalizedUsernameAsync(UserAccount.NormalizeUsername(login), cancellationToken);

        if (user is null ||
            !user.IsActive ||
            !passwordService.VerifyPassword(user, user.PasswordHash, command.Password))
        {
            return LoginResult.Invalid(LoginFailure.InvalidCredentials);
        }

        return await CreateSessionAsync(user, cancellationToken);
    }

    public async Task<LoginResult> CreateSessionAsync(
        UserAccount user,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);

        var now = timeProvider.GetUtcNow();
        var expiresAt = now.Add(settings.MaximumSessionDuration);
        var csrfToken = CreateCsrfToken();
        var session = new UserSession(
            Guid.NewGuid(),
            user.Id,
            Guid.NewGuid().ToString("N"),
            HashCsrfToken(csrfToken),
            now,
            expiresAt);

        user.MarkLogin(now);
        identityStore.AddSession(session);
        await identityStore.SaveChangesAsync(cancellationToken);

        return LoginResult.Success(
            session.Id,
            csrfToken,
            expiresAt,
            ToCurrentUser(user));
    }

    public static CurrentUser ToCurrentUser(UserAccount user)
    {
        var roles = user.Roles
            .Select(userRole => userRole.Role.Name)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var assignedPermissions = user.Roles
            .SelectMany(userRole => userRole.Role.Permissions)
            .Select(rolePermission => rolePermission.Permission.Name)
            .ToArray();
        var permissions = SystemRoles.ResolvePermissions(roles, assignedPermissions);
        return new CurrentUser(user.Id, user.Username, user.DisplayName, roles, permissions, user.MustChangePassword);
    }

    public async Task<CurrentUser?> ValidateSessionAsync(
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        var session = await identityStore.FindSessionAsync(sessionId, cancellationToken);
        var now = timeProvider.GetUtcNow();

        if (session is null || !session.User.IsActive || !session.IsValidAt(now, settings.IdleTimeout))
        {
            return null;
        }

        if (session.LastSeenAtUtc.AddMinutes(5) <= now)
        {
            session.MarkSeen(now);
            await identityStore.SaveChangesAsync(cancellationToken);
        }

        var roles = session.User.Roles
            .Select(userRole => userRole.Role.Name)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var assignedPermissions = session.User.Roles
            .SelectMany(userRole => userRole.Role.Permissions)
            .Select(rolePermission => rolePermission.Permission.Name)
            .ToArray();
        var permissions = SystemRoles.ResolvePermissions(roles, assignedPermissions);

        return new CurrentUser(
            session.User.Id,
            session.User.Username,
            session.User.DisplayName,
            roles,
            permissions,
            session.User.MustChangePassword);
    }

    public async Task<bool> LogoutAsync(
        Guid sessionId,
        string csrfToken,
        CancellationToken cancellationToken)
    {
        var session = await identityStore.FindSessionAsync(sessionId, cancellationToken);
        if (session is null || !MatchesCsrfToken(session.CsrfTokenHash, csrfToken))
        {
            return false;
        }

        session.Revoke(timeProvider.GetUtcNow(), "user_logout");
        await identityStore.SaveChangesAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// Comprueba que el token CSRF enviado corresponde a la sesión indicada.
    /// </summary>
    public async Task<bool> ValidateCsrfAsync(
        Guid sessionId,
        string csrfToken,
        CancellationToken cancellationToken)
    {
        var session = await identityStore.FindSessionAsync(sessionId, cancellationToken);
        return session is not null && MatchesCsrfToken(session.CsrfTokenHash, csrfToken);
    }

    private static string CreateCsrfToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    private static string HashCsrfToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static bool MatchesCsrfToken(string expectedHash, string providedToken)
    {
        if (string.IsNullOrWhiteSpace(providedToken))
        {
            return false;
        }

        var actualHash = HashCsrfToken(providedToken);
        return CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(expectedHash),
            Convert.FromHexString(actualHash));
    }
}
