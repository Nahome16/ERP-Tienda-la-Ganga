namespace LaGanga.Domain.Identity;

public sealed class Role
{
    private readonly List<RolePermissionGrant> _permissions = [];

    private Role()
    {
    }

    public Role(Guid id, string name)
    {
        Id = id;
        Name = name;
        NormalizedName = name.Trim().ToUpperInvariant();
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string NormalizedName { get; private set; } = string.Empty;

    public IReadOnlyCollection<RolePermissionGrant> Permissions => _permissions;

    public void AddPermission(PermissionGrant permission) =>
        _permissions.Add(new RolePermissionGrant(Id, permission.Id));

    public bool HasPermission(Guid permissionId) =>
        _permissions.Exists(grant => grant.PermissionId == permissionId);
}
