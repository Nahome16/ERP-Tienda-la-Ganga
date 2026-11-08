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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LaGangaDbContext).Assembly);
    }
}
