using LaGanga.Domain.Catalog;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Inventory;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LaGanga.Infrastructure.Persistence;

public sealed class ProductConfiguration : IEntityTypeConfiguration<Product>
{
    public void Configure(EntityTypeBuilder<Product> builder)
    {
        builder.ToTable("products", "inventory", table =>
            table.HasCheckConstraint("CK_products_base_price", "\"BasePrice\" >= 0"));
        builder.HasKey(product => product.Id);
        builder.Property(product => product.Id).ValueGeneratedNever();
        builder.Property(product => product.Name).HasMaxLength(Product.NameMaxLength).IsRequired();
        builder.Property(product => product.BasePrice).HasPrecision(18, 2);
        builder.Property(product => product.Version).IsConcurrencyToken();
        builder.HasOne<Category>().WithMany().HasForeignKey(product => product.CategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Brand>().WithMany().HasForeignKey(product => product.BrandId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Cut>().WithMany().HasForeignKey(product => product.CutId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(product => product.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(product => product.UpdatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(product => product.Variants).WithOne().HasForeignKey(variant => variant.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.Navigation(product => product.Variants).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasIndex(product => product.Name);
    }
}

public sealed class ProductVariantConfiguration : IEntityTypeConfiguration<ProductVariant>
{
    public void Configure(EntityTypeBuilder<ProductVariant> builder)
    {
        builder.ToTable("product_variants", "inventory", table =>
        {
            table.HasCheckConstraint("CK_product_variants_price", "\"PriceOverride\" IS NULL OR \"PriceOverride\" >= 0");
            table.HasCheckConstraint("CK_product_variants_cost", "\"Cost\" IS NULL OR \"Cost\" >= 0");
        });
        builder.HasKey(variant => variant.Id);
        builder.Property(variant => variant.Id).ValueGeneratedNever();
        builder.Property(variant => variant.Barcode).HasMaxLength(ProductVariant.BarcodeMaxLength).IsRequired();
        builder.Property(variant => variant.PriceOverride).HasPrecision(18, 2);
        builder.Property(variant => variant.Cost).HasPrecision(18, 4);
        builder.Property(variant => variant.Version).IsConcurrencyToken();
        builder.HasOne<Size>().WithMany().HasForeignKey(variant => variant.SizeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Color>().WithMany().HasForeignKey(variant => variant.ColorId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(variant => variant.Balance).WithOne().HasForeignKey<StockBalance>(balance => balance.VariantId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(variant => variant.Barcode).IsUnique();
        builder.HasIndex(variant => new { variant.ProductId, variant.SizeId, variant.ColorId }).IsUnique();
    }
}

public sealed class StockBalanceConfiguration : IEntityTypeConfiguration<StockBalance>
{
    public void Configure(EntityTypeBuilder<StockBalance> builder)
    {
        builder.ToTable("stock_balances", "inventory");
        builder.HasKey(balance => balance.VariantId);
        builder.Property(balance => balance.VariantId).ValueGeneratedNever();
    }
}

public sealed class InventoryMovementConfiguration : IEntityTypeConfiguration<InventoryMovement>
{
    public void Configure(EntityTypeBuilder<InventoryMovement> builder)
    {
        builder.ToTable("inventory_movements", "inventory", table =>
            table.HasCheckConstraint("CK_inventory_movements_quantity", "\"Quantity\" <> 0"));
        builder.HasKey(movement => movement.Id);
        builder.Property(movement => movement.Id).ValueGeneratedNever();
        builder.Property(movement => movement.Type).HasConversion<string>().HasMaxLength(20);
        builder.Property(movement => movement.Reason).HasMaxLength(500);
        builder.HasOne<ProductVariant>().WithMany().HasForeignKey(movement => movement.VariantId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(movement => movement.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(movement => new { movement.VariantId, movement.CreatedAtUtc });
        builder.HasIndex(movement => movement.SaleId);
    }
}
