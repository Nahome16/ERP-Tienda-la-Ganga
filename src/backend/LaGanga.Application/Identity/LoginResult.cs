namespace LaGanga.Application.Identity;

public enum LoginFailure
{
    None,
    InvalidCredentials,
    InvalidRequest,
}

public sealed record LoginResult(
    LoginFailure Failure,
    Guid? SessionId,
    string? CsrfToken,
    DateTimeOffset? ExpiresAtUtc,
    CurrentUser? User)
{
    public bool Succeeded => Failure == LoginFailure.None;

    public static LoginResult Invalid(LoginFailure failure) =>
        new(failure, null, null, null, null);

    public static LoginResult Success(
        Guid sessionId,
        string csrfToken,
        DateTimeOffset expiresAtUtc,
        CurrentUser user) =>
        new(LoginFailure.None, sessionId, csrfToken, expiresAtUtc, user);
}
