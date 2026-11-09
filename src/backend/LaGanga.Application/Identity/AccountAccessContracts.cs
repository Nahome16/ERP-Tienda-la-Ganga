namespace LaGanga.Application.Identity;

public enum AccessCodeFailure
{
    None,
    InvalidRequest,
    InvalidCode,
}

public sealed record AccessCodeResult(AccessCodeFailure Failure, LoginResult? Login)
{
    public bool Succeeded => Failure == AccessCodeFailure.None && Login?.Succeeded == true;

    public static AccessCodeResult Invalid(AccessCodeFailure failure) => new(failure, null);

    public static AccessCodeResult Success(LoginResult login) => new(AccessCodeFailure.None, login);
}

public enum PasswordChangeFailure
{
    None,
    InvalidRequest,
    InvalidCurrentPassword,
    UserNotFound,
}

public sealed record PasswordChangeResult(PasswordChangeFailure Failure, CurrentUser? User)
{
    public bool Succeeded => Failure == PasswordChangeFailure.None && User is not null;

    public static PasswordChangeResult Invalid(PasswordChangeFailure failure) => new(failure, null);

    public static PasswordChangeResult Success(CurrentUser user) => new(PasswordChangeFailure.None, user);
}

public interface IAccountAccessService
{
    Task RequestCodeAsync(string? email, CancellationToken cancellationToken);

    Task<AccessCodeResult> VerifyCodeAsync(string? email, string? code, CancellationToken cancellationToken);

    Task<PasswordChangeResult> ChangePasswordAsync(
        Guid userId,
        Guid currentSessionId,
        bool emailCodeVerified,
        string? currentPassword,
        string? newPassword,
        CancellationToken cancellationToken);
}

public interface IEmailSender
{
    Task SendAccessCodeAsync(
        string email,
        string displayName,
        string code,
        DateTimeOffset expiresAtUtc,
        CancellationToken cancellationToken);
}

public sealed class AccessCodeSettings
{
    public const string SectionName = "AccessCodes";

    public TimeSpan Lifetime { get; init; } = TimeSpan.FromMinutes(10);

    public TimeSpan ResendCooldown { get; init; } = TimeSpan.FromMinutes(1);

    public int MaximumAttempts { get; init; } = 5;
}
