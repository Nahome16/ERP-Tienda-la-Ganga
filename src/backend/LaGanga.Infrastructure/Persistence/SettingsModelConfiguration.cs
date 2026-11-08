using LaGanga.Domain.Identity;
using LaGanga.Domain.Settings;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LaGanga.Infrastructure.Persistence;

public sealed class StoreSettingsConfiguration : IEntityTypeConfiguration<StoreSettings>
{
    public void Configure(EntityTypeBuilder<StoreSettings> builder)
    {
        builder.ToTable("store_settings", "system", table =>
        {
            table.HasCheckConstraint("CK_store_settings_singleton", "\"Id\" = 1");
            table.HasCheckConstraint("CK_store_settings_rate", "\"UsdRate\" > 0");
            table.HasCheckConstraint("CK_store_settings_limit", "\"SellerDiscountLimitPercent\" BETWEEN 0 AND 100");
        });
        builder.HasKey(settings => settings.Id);
        builder.Property(settings => settings.Id).ValueGeneratedNever();
        builder.Property(settings => settings.UsdRate).HasPrecision(18, 4);
        builder.Property(settings => settings.SellerDiscountLimitPercent).HasPrecision(5, 2);
        builder.Property(settings => settings.StoreName).HasMaxLength(120).IsRequired();
        builder.Property(settings => settings.StoreAddress).HasMaxLength(250).IsRequired();
        builder.Property(settings => settings.StorePhone).HasMaxLength(50).IsRequired();
        builder.Property(settings => settings.ReceiptFooter).HasMaxLength(250).IsRequired();
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(settings => settings.UpdatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasData(new
        {
            Id = StoreSettings.SingletonId,
            UsdRate = 36.7m,
            StoreName = "Tienda La Ganga",
            StoreAddress = string.Empty,
            StorePhone = string.Empty,
            ReceiptFooter = "Recibo interno — no es factura",
            Banks = Array.Empty<string>(),
            SellerDiscountLimitPercent = 10m,
            LowStockThreshold = 2,
            UpdatedAtUtc = new DateTimeOffset(2026, 11, 8, 0, 0, 0, TimeSpan.Zero),
        });
    }
}

public sealed class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
    public void Configure(EntityTypeBuilder<AuditEvent> builder)
    {
        builder.ToTable("audit_events", "system");
        builder.HasKey(auditEvent => auditEvent.Id);
        builder.Property(auditEvent => auditEvent.Id).ValueGeneratedNever();
        builder.Property(auditEvent => auditEvent.Action).HasMaxLength(60).IsRequired();
        builder.Property(auditEvent => auditEvent.EntityType).HasMaxLength(60).IsRequired();
        builder.Property(auditEvent => auditEvent.EntityId).HasMaxLength(60).IsRequired();
        builder.Property(auditEvent => auditEvent.Summary).HasMaxLength(1000).IsRequired();
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(auditEvent => auditEvent.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(auditEvent => auditEvent.OccurredAtUtc);
        builder.HasIndex(auditEvent => new { auditEvent.EntityType, auditEvent.EntityId });
    }
}
