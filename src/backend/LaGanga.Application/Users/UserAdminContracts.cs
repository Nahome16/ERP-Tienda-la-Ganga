namespace LaGanga.Application.Users;

public sealed record RoleReferenceDto(Guid Id, string Name);

public sealed record UserSummaryDto(
    Guid Id,
    string Username,
    string DisplayName,
    bool IsActive,
    IReadOnlyList<RoleReferenceDto> Roles,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? LastLoginAtUtc);

public sealed record RoleDto(Guid Id, string Name, IReadOnlyList<string> Permissions);

public sealed record CreateUserInput(
    string? Username,
    string? DisplayName,
    string? Password,
    IReadOnlyList<Guid>? RoleIds);

public sealed record UpdateUserInput(
    string? DisplayName,
    IReadOnlyList<Guid>? RoleIds,
    bool? IsActive);

public enum UserAdminErrorKind
{
    Validation,
    NotFound,
    Conflict,
    BusinessRule,
}

public sealed record UserAdminError(
    UserAdminErrorKind Kind,
    string Code,
    string Message,
    string? Field = null);

public sealed class UserAdminResult<T>
{
    internal UserAdminResult(T? value, UserAdminError? error)
    {
        Value = value;
        Error = error;
    }

    public T? Value { get; }

    public UserAdminError? Error { get; }

    public bool Succeeded => Error is null;
}

public static class UserAdminResult
{
    public static UserAdminResult<T> Success<T>(T value) => new(value, null);

    public static UserAdminResult<T> Failure<T>(UserAdminError error) => new(default, error);
}

public static class UserRules
{
    public const int UsernameMinLength = 3;
    public const int UsernameMaxLength = 64;
    public const int DisplayNameMaxLength = 120;
    public const int PasswordMinLength = 12;
    public const int PasswordMaxLength = 256;

    /// <summary>Letras sin acentos, números, punto, guion y guion bajo.</summary>
    public static bool IsValidUsername(string username) =>
        username.Length is >= UsernameMinLength and <= UsernameMaxLength &&
        username.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-');
}

public interface IUserAdminService
{
    Task<IReadOnlyList<UserSummaryDto>> ListUsersAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<RoleDto>> ListRolesAsync(CancellationToken cancellationToken);

    Task<UserAdminResult<UserSummaryDto>> CreateAsync(
        CreateUserInput input,
        CancellationToken cancellationToken);

    Task<UserAdminResult<UserSummaryDto>> UpdateAsync(
        Guid userId,
        UpdateUserInput input,
        Guid actorId,
        CancellationToken cancellationToken);

    Task<UserAdminResult<UserSummaryDto>> ResetPasswordAsync(
        Guid userId,
        string? newPassword,
        CancellationToken cancellationToken);
}
