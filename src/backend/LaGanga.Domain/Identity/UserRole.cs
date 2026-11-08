namespace LaGanga.Domain.Identity;

public sealed class UserRole
{
    private UserRole()
    {
    }

    public UserRole(Guid userId, Guid roleId)
    {
        UserId = userId;
        RoleId = roleId;
    }

    public Guid UserId { get; private set; }

    public Guid RoleId { get; private set; }

    public UserAccount User { get; private set; } = null!;

    public Role Role { get; private set; } = null!;
}
