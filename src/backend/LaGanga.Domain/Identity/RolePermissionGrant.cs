namespace LaGanga.Domain.Identity;

public sealed class RolePermissionGrant
{
    private RolePermissionGrant()
    {
    }

    public RolePermissionGrant(Guid roleId, Guid permissionId)
    {
        RoleId = roleId;
        PermissionId = permissionId;
    }

    public Guid RoleId { get; private set; }

    public Guid PermissionId { get; private set; }

    public Role Role { get; private set; } = null!;

    public PermissionGrant Permission { get; private set; } = null!;
}
