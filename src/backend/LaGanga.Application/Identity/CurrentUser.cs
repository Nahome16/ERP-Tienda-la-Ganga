namespace LaGanga.Application.Identity;

public sealed record CurrentUser(
    Guid Id,
    string Username,
    string DisplayName,
    IReadOnlyCollection<string> Roles,
    IReadOnlyCollection<string> Permissions,
    bool MustChangePassword);
