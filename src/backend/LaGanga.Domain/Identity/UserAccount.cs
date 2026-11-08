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

    public void ChangeDisplayName(string displayName) => DisplayName = displayName.Trim();

    public void Activate() => IsActive = true;

    public void Deactivate() => IsActive = false;

    /// <summary>Reemplaza los roles por exactamente los indicados.</summary>
    public void ReplaceRoles(IReadOnlyCollection<Role> roles)
    {
        ArgumentNullException.ThrowIfNull(roles);

        var wanted = roles.Select(role => role.Id).ToHashSet();
        _roles.RemoveAll(userRole => !wanted.Contains(userRole.RoleId));
        foreach (var role in roles)
        {
            if (_roles.TrueForAll(userRole => userRole.RoleId != role.Id))
            {
                _roles.Add(new UserRole(Id, role.Id));
            }
        }
    }
}
