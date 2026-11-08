using LaGanga.Domain.Catalog;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Inventory;
using LaGanga.Domain.Sales;
using LaGanga.Domain.Settings;
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

    public DbSet<Product> Products => Set<Product>();

    public DbSet<ProductVariant> Variants => Set<ProductVariant>();

    public DbSet<ProductImage> ProductImages => Set<ProductImage>();

    public DbSet<Partner> Partners => Set<Partner>();

    public DbSet<StockLot> StockLots => Set<StockLot>();

    public DbSet<LotAllocation> LotAllocations => Set<LotAllocation>();

    public DbSet<StockBalance> StockBalances => Set<StockBalance>();

    public DbSet<InventoryMovement> Movements => Set<InventoryMovement>();

    public DbSet<CashRegister> CashRegisters => Set<CashRegister>();

    public DbSet<CashSession> CashSessions => Set<CashSession>();

    public DbSet<Sale> Sales => Set<Sale>();

    public DbSet<SaleLine> SaleLines => Set<SaleLine>();

    public DbSet<SalePayment> SalePayments => Set<SalePayment>();

    public DbSet<DiscountApproval> DiscountApprovals => Set<DiscountApproval>();

    public DbSet<StoreSettings> Settings => Set<StoreSettings>();

    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

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
        modelBuilder.HasSequence<long>(SalesSchema.SaleNumberSequence, SalesSchema.Name).StartsAt(1);
        modelBuilder.HasSequence<long>("barcode_seq", "inventory").StartsAt(1);
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

        foreach (var entry in ChangeTracker.Entries<Product>().Where(entry => entry.State == EntityState.Modified))
        {
            var version = entry.Property(product => product.Version);
            version.CurrentValue = version.OriginalValue + 1;
        }

        foreach (var entry in ChangeTracker.Entries<Partner>().Where(entry => entry.State == EntityState.Modified))
        {
            var version = entry.Property(partner => partner.Version);
            version.CurrentValue = version.OriginalValue + 1;
        }

        foreach (var entry in ChangeTracker.Entries<ProductVariant>().Where(entry => entry.State == EntityState.Modified))
        {
            var version = entry.Property(variant => variant.Version);
            version.CurrentValue = version.OriginalValue + 1;
        }
    }
}
