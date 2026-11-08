namespace LaGanga.Domain.Identity;

public sealed class UserAccount
{
    private readonly List<UserRole> _roles = [];

    private UserAccount()
    {
    }

    public UserAccount(Guid id, string username, string displayName, DateTimeOffset createdAtUtc)
    {
        Id = id;
        Username = username;
        NormalizedUsername = NormalizeUsername(username);
        DisplayName = displayName;
        CreatedAtUtc = createdAtUtc;
        IsActive = true;
        PasswordHash = string.Empty;
        SecurityStamp = Guid.NewGuid().ToString("N");
    }

    public Guid Id { get; private set; }

    public string Username { get; private set; } = string.Empty;

    public string NormalizedUsername { get; private set; } = string.Empty;

    public string DisplayName { get; private set; } = string.Empty;

    public string PasswordHash { get; private set; } = string.Empty;

    public string SecurityStamp { get; private set; } = string.Empty;

    public bool IsActive { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? LastLoginAtUtc { get; private set; }

    public IReadOnlyCollection<UserRole> Roles => _roles;

    public static string NormalizeUsername(string username) =>
        username.Trim().ToUpperInvariant();

    public void SetPasswordHash(string passwordHash)
    {
        PasswordHash = passwordHash;
        SecurityStamp = Guid.NewGuid().ToString("N");
    }

    public void MarkLogin(DateTimeOffset loggedInAtUtc) => LastLoginAtUtc = loggedInAtUtc;

    public void AddRole(Role role) => _roles.Add(new UserRole(Id, role.Id));
}
