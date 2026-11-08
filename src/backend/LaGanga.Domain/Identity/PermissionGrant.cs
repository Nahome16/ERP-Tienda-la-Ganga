namespace LaGanga.Domain.Identity;

public sealed class PermissionGrant
{
    private PermissionGrant()
    {
    }

    public PermissionGrant(Guid id, string name)
    {
        Id = id;
        Name = name;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;
}
