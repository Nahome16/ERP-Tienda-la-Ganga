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
        builder.Property(product => product.Barcode).HasMaxLength(Product.BarcodeMaxLength);
        builder.HasIndex(product => product.Barcode).IsUnique().HasFilter("\"Barcode\" IS NOT NULL");
        builder.Property(product => product.ReferenceCode).HasMaxLength(Product.ReferenceCodeMaxLength);
        builder.HasIndex(product => product.ReferenceCode);
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

public sealed class ProductColorBarcodeConfiguration : IEntityTypeConfiguration<ProductColorBarcode>
{
    public void Configure(EntityTypeBuilder<ProductColorBarcode> builder)
    {
        builder.ToTable("product_color_barcodes", "inventory");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Barcode).HasMaxLength(Product.BarcodeMaxLength).IsRequired();
        builder.HasIndex(item => item.Barcode).IsUnique();
        builder.HasIndex(item => new { item.ProductId, item.ColorId }).IsUnique();
        builder.HasOne<Product>().WithMany().HasForeignKey(item => item.ProductId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Color>().WithMany().HasForeignKey(item => item.ColorId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ProductImageConfiguration : IEntityTypeConfiguration<ProductImage>
{
    public void Configure(EntityTypeBuilder<ProductImage> builder)
    {
        builder.ToTable("product_images", "inventory", table =>
            table.HasCheckConstraint("CK_product_images_sort_order", "\"SortOrder\" >= 0"));
        builder.HasKey(image => image.Id);
        builder.Property(image => image.Id).ValueGeneratedNever();
        builder.Property(image => image.FileName).HasMaxLength(ProductImage.FileNameMaxLength).IsRequired();
        builder.Property(image => image.ThumbFileName).HasMaxLength(ProductImage.FileNameMaxLength).IsRequired();
        builder.HasOne<Product>().WithMany().HasForeignKey(image => image.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(image => image.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(image => new { image.ProductId, image.SortOrder });
    }
}

public sealed class PartnerConfiguration : IEntityTypeConfiguration<Partner>
{
    public void Configure(EntityTypeBuilder<Partner> builder)
    {
        builder.ToTable("partners", "inventory");
        builder.HasKey(partner => partner.Id);
        builder.Property(partner => partner.Id).ValueGeneratedNever();
        builder.Property(partner => partner.Name).HasMaxLength(Partner.NameMaxLength).IsRequired();
        builder.Property(partner => partner.NormalizedName).HasMaxLength(Partner.NameMaxLength).IsRequired();
        builder.Property(partner => partner.Phone).HasMaxLength(50);
        builder.Property(partner => partner.Notes).HasMaxLength(500);
        builder.Property(partner => partner.Version).IsConcurrencyToken();
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(partner => partner.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(partner => partner.NormalizedName).IsUnique();
    }
}

public sealed class StockLotConfiguration : IEntityTypeConfiguration<StockLot>
{
    public void Configure(EntityTypeBuilder<StockLot> builder)
    {
        builder.ToTable("stock_lots", "inventory", table =>
        {
            table.HasCheckConstraint("CK_stock_lots_quantities", "\"QuantityIn\" > 0 AND \"QuantityRemaining\" >= 0 AND \"QuantityRemaining\" <= \"QuantityIn\"");
            table.HasCheckConstraint("CK_stock_lots_money", "(\"UnitCost\" IS NULL OR \"UnitCost\" >= 0) AND (\"UnitPrice\" IS NULL OR \"UnitPrice\" >= 0)");
        });
        builder.HasKey(lot => lot.Id);
        builder.Property(lot => lot.Id).ValueGeneratedNever();
        builder.Property(lot => lot.Source).HasConversion<string>().HasMaxLength(20);
        builder.Property(lot => lot.UnitCost).HasPrecision(18, 4);
        builder.Property(lot => lot.UnitPrice).HasPrecision(18, 2);
        builder.Property(lot => lot.Note).HasMaxLength(500);
        builder.HasOne<ProductVariant>().WithMany().HasForeignKey(lot => lot.VariantId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Partner>().WithMany().HasForeignKey(lot => lot.PartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(lot => lot.EnteredBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(lot => new { lot.VariantId, lot.EnteredAtUtc });
        builder.HasIndex(lot => lot.PartnerId);
    }
}

public sealed class LotAllocationConfiguration : IEntityTypeConfiguration<LotAllocation>
{
    public void Configure(EntityTypeBuilder<LotAllocation> builder)
    {
        builder.ToTable("lot_allocations", "inventory", table =>
            table.HasCheckConstraint("CK_lot_allocations_quantity", "\"Quantity\" > 0"));
        builder.HasKey(allocation => allocation.Id);
        builder.Property(allocation => allocation.Id).ValueGeneratedNever();
        builder.Property(allocation => allocation.Kind).HasConversion<string>().HasMaxLength(10);
        builder.HasOne<StockLot>().WithMany().HasForeignKey(allocation => allocation.LotId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ProductVariant>().WithMany().HasForeignKey(allocation => allocation.VariantId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(allocation => allocation.LotId);
        builder.HasIndex(allocation => allocation.SaleId);
    }
}

public sealed class LabelPrintConfiguration : IEntityTypeConfiguration<LabelPrint>
{
    public void Configure(EntityTypeBuilder<LabelPrint> builder)
    {
        builder.ToTable("label_prints", "inventory", table =>
            table.HasCheckConstraint("CK_label_prints_copies", "\"Copies\" >= 0"));
        builder.HasKey(print => print.Id);
        builder.Property(print => print.Id).ValueGeneratedNever();
        builder.HasOne<Product>().WithMany().HasForeignKey(print => print.ProductId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ProductVariant>().WithMany().HasForeignKey(print => print.VariantId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(print => new { print.ProductId, print.PrintedAtUtc });
        builder.HasIndex(print => print.VariantId);
    }
}
