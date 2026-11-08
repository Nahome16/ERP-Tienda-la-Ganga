using LaGanga.Domain.Catalog;
using LaGanga.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LaGanga.Infrastructure.Persistence;

internal static class CatalogEntryMapping
{
    public const string Schema = "catalog";

    public static void Configure<T>(EntityTypeBuilder<T> builder, string table, int nameMaxLength)
        where T : CatalogEntry
    {
        builder.ToTable(table, Schema, tableBuilder =>
            tableBuilder.HasCheckConstraint($"CK_{table}_sort_order", "\"SortOrder\" >= 0"));
        builder.HasKey(entry => entry.Id);
        builder.Property(entry => entry.Id).ValueGeneratedNever();
        builder.Property(entry => entry.Name).HasMaxLength(nameMaxLength).IsRequired();
        builder.Property(entry => entry.NormalizedName).HasMaxLength(nameMaxLength).IsRequired();
        builder.Property(entry => entry.Version).IsConcurrencyToken();
        builder.HasOne<UserAccount>()
            .WithMany()
            .HasForeignKey(entry => entry.CreatedBy)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>()
            .WithMany()
            .HasForeignKey(entry => entry.UpdatedBy)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class BrandConfiguration : IEntityTypeConfiguration<Brand>
{
    public void Configure(EntityTypeBuilder<Brand> builder)
    {
        CatalogEntryMapping.Configure(builder, "brands", Brand.NameMaxLength);
        builder.HasIndex(brand => brand.NormalizedName).IsUnique();
    }
}

public sealed class CutConfiguration : IEntityTypeConfiguration<Cut>
{
    public void Configure(EntityTypeBuilder<Cut> builder)
    {
        CatalogEntryMapping.Configure(builder, "cuts", Cut.NameMaxLength);
        builder.HasIndex(cut => cut.NormalizedName).IsUnique();
    }
}

public sealed class SizeGroupConfiguration : IEntityTypeConfiguration<SizeGroup>
{
    public void Configure(EntityTypeBuilder<SizeGroup> builder)
    {
        CatalogEntryMapping.Configure(builder, "size_groups", SizeGroup.NameMaxLength);
        builder.HasIndex(group => group.NormalizedName).IsUnique();
    }
}

public sealed class CategoryConfiguration : IEntityTypeConfiguration<Category>
{
    public void Configure(EntityTypeBuilder<Category> builder)
    {
        CatalogEntryMapping.Configure(builder, "categories", Category.NameMaxLength);
        builder.ToTable(tableBuilder => tableBuilder.HasCheckConstraint(
            "CK_categories_not_own_parent",
            "\"ParentId\" IS NULL OR \"ParentId\" <> \"Id\""));
        builder.HasOne<Category>()
            .WithMany()
            .HasForeignKey(category => category.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        // Nombre único entre hermanas; dos raíces con el mismo nombre también chocan.
        builder.HasIndex(category => new { category.ParentId, category.NormalizedName })
            .IsUnique()
            .AreNullsDistinct(false);
    }
}

public sealed class SizeConfiguration : IEntityTypeConfiguration<Size>
{
    public void Configure(EntityTypeBuilder<Size> builder)
    {
        CatalogEntryMapping.Configure(builder, "sizes", Size.NameMaxLength);
        builder.HasOne<SizeGroup>()
            .WithMany()
            .HasForeignKey(size => size.SizeGroupId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(size => new { size.SizeGroupId, size.NormalizedName })
            .IsUnique()
            .AreNullsDistinct(false);
    }
}

public sealed class ColorConfiguration : IEntityTypeConfiguration<Color>
{
    public void Configure(EntityTypeBuilder<Color> builder)
    {
        CatalogEntryMapping.Configure(builder, "colors", Color.NameMaxLength);
        builder.ToTable(tableBuilder => tableBuilder.HasCheckConstraint(
            "CK_colors_swatch_hex",
            "\"SwatchHex\" IS NULL OR \"SwatchHex\" ~ '^#[0-9A-F]{6}$'"));
        builder.Property(color => color.SwatchHex).HasMaxLength(7).IsFixedLength();
        builder.HasIndex(color => color.NormalizedName).IsUnique();
    }
}
