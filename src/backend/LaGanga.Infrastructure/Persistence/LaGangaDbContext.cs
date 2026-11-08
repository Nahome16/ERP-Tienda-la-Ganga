using LaGanga.Domain.Catalog;
using LaGanga.Domain.Identity;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Persistence;

public sealed class LaGangaDbContext(DbContextOptions<LaGangaDbContext> options)
    : DbContext(options)
{
    public DbSet<UserAccount> Users => Set<UserAccount>();

    public DbSet<Role> Roles => Set<Role>();

    public DbSet<PermissionGrant> Permissions => Set<PermissionGrant>();

    public DbSet<UserRole> UserRoles => Set<UserRole>();

    public DbSet<RolePermissionGrant> RolePermissions => Set<RolePermissionGrant>();

    public DbSet<UserSession> Sessions => Set<UserSession>();

    public DbSet<Category> Categories => Set<Category>();

    public DbSet<Brand> Brands => Set<Brand>();

    public DbSet<Cut> Cuts => Set<Cut>();

    public DbSet<SizeGroup> SizeGroups => Set<SizeGroup>();

    public DbSet<Size> Sizes => Set<Size>();

    public DbSet<Color> Colors => Set<Color>();

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        IncrementCatalogVersions();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        IncrementCatalogVersions();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LaGangaDbContext).Assembly);
    }

    /// <summary>
    /// Cada guardado de un catálogo modificado sube su versión en uno. EF usa
    /// la versión original como condición, así dos ediciones simultáneas no se
    /// sobrescriben: la segunda recibe un conflicto.
    /// </summary>
    private void IncrementCatalogVersions()
    {
        foreach (var entry in ChangeTracker.Entries<CatalogEntry>())
        {
            if (entry.State != EntityState.Modified)
            {
                continue;
            }

            var version = entry.Property(catalogEntry => catalogEntry.Version);
            version.CurrentValue = version.OriginalValue + 1;
        }
    }
}
