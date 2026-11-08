using LaGanga.Domain.Identity;
using LaGanga.Domain.Inventory;
using LaGanga.Domain.Sales;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LaGanga.Infrastructure.Persistence;

public static class SalesSchema
{
    public const string Name = "sales";
    public const string SaleNumberSequence = "sale_number_seq";

    public static readonly Guid Register1Id = new("0f6c1b52-8d4e-4d0b-9a77-1b8f6c2a0001");
    public static readonly Guid Register2Id = new("0f6c1b52-8d4e-4d0b-9a77-1b8f6c2a0002");
}

public sealed class CashRegisterConfiguration : IEntityTypeConfiguration<CashRegister>
{
    public void Configure(EntityTypeBuilder<CashRegister> builder)
    {
        builder.ToTable("cash_registers", SalesSchema.Name);
        builder.HasKey(register => register.Id);
        builder.Property(register => register.Id).ValueGeneratedNever();
        builder.Property(register => register.Name).HasMaxLength(CashRegister.NameMaxLength).IsRequired();
        builder.HasIndex(register => register.Name).IsUnique();
        builder.HasData(
            new { Id = SalesSchema.Register1Id, Name = "Caja 1", IsActive = true },
            new { Id = SalesSchema.Register2Id, Name = "Caja 2", IsActive = true });
    }
}

public sealed class CashSessionConfiguration : IEntityTypeConfiguration<CashSession>
{
    public void Configure(EntityTypeBuilder<CashSession> builder)
    {
        builder.ToTable("cash_sessions", SalesSchema.Name, table =>
        {
            table.HasCheckConstraint("CK_cash_sessions_float", "\"OpeningFloatNio\" >= 0 AND \"OpeningFloatUsd\" >= 0");
        });
        builder.HasKey(session => session.Id);
        builder.Property(session => session.Id).ValueGeneratedNever();
        builder.Property(session => session.OpeningFloatNio).HasPrecision(18, 2);
        builder.Property(session => session.OpeningFloatUsd).HasPrecision(18, 2);
        builder.Property(session => session.CountedCashNio).HasPrecision(18, 2);
        builder.Property(session => session.CountedCashUsd).HasPrecision(18, 2);
        builder.Property(session => session.CountedTransferNio).HasPrecision(18, 2);
        builder.Property(session => session.CountedTransferUsd).HasPrecision(18, 2);
        builder.Property(session => session.CountedCardNio).HasPrecision(18, 2);
        builder.Property(session => session.CountedCardUsd).HasPrecision(18, 2);
        builder.Property(session => session.ClosingNotes).HasMaxLength(500);
        builder.HasOne(session => session.Register).WithMany().HasForeignKey(session => session.RegisterId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(session => session.OpenedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(session => session.ClosedByUserId).OnDelete(DeleteBehavior.Restrict);

        // Una sola sesión abierta por caja y por persona.
        builder.HasIndex(session => session.RegisterId).IsUnique().HasFilter("\"ClosedAtUtc\" IS NULL")
            .HasDatabaseName("UX_cash_sessions_open_register");
        builder.HasIndex(session => session.OpenedByUserId).IsUnique().HasFilter("\"ClosedAtUtc\" IS NULL")
            .HasDatabaseName("UX_cash_sessions_open_user");
        builder.HasIndex(session => session.OpenedAtUtc);
    }
}

public sealed class SaleConfiguration : IEntityTypeConfiguration<Sale>
{
    public void Configure(EntityTypeBuilder<Sale> builder)
    {
        builder.ToTable("sales", SalesSchema.Name, table =>
        {
            table.HasCheckConstraint("CK_sales_amounts", "\"SubtotalNio\" >= 0 AND \"DiscountNio\" >= 0 AND \"TotalNio\" >= 0 AND \"ChangeNio\" >= 0");
        });
        builder.HasKey(sale => sale.Id);
        builder.Property(sale => sale.Id).ValueGeneratedNever();
        builder.Property(sale => sale.Number).HasDefaultValueSql($"nextval('{SalesSchema.Name}.{SalesSchema.SaleNumberSequence}')")
            .ValueGeneratedOnAdd();
        builder.Property(sale => sale.Channel).HasConversion<string>().HasMaxLength(20);
        builder.Property(sale => sale.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(sale => sale.DiscountType).HasConversion<string>().HasMaxLength(20);
        builder.Property(sale => sale.SubtotalNio).HasPrecision(18, 2);
        builder.Property(sale => sale.DiscountValue).HasPrecision(18, 2);
        builder.Property(sale => sale.DiscountNio).HasPrecision(18, 2);
        builder.Property(sale => sale.TotalNio).HasPrecision(18, 2);
        builder.Property(sale => sale.ChangeNio).HasPrecision(18, 2);
        builder.Property(sale => sale.ReviewNote).HasMaxLength(1000);
        builder.Property(sale => sale.Note).HasMaxLength(500);
        builder.Property(sale => sale.VoidReason).HasMaxLength(500);
        builder.HasOne(sale => sale.CashSession).WithMany().HasForeignKey(sale => sale.CashSessionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(sale => sale.SellerUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(sale => sale.VoidedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(sale => sale.Lines).WithOne().HasForeignKey(line => line.SaleId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(sale => sale.Payments).WithOne().HasForeignKey(payment => payment.SaleId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(sale => sale.Lines).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(sale => sale.Payments).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasIndex(sale => sale.ClientSaleId).IsUnique();
        builder.HasIndex(sale => sale.Number).IsUnique();
        builder.HasIndex(sale => sale.CashSessionId);
        builder.HasIndex(sale => sale.CreatedAtUtc);
        builder.HasIndex(sale => sale.RequiresReview).HasFilter("\"RequiresReview\"");
    }
}

public sealed class SaleLineConfiguration : IEntityTypeConfiguration<SaleLine>
{
    public void Configure(EntityTypeBuilder<SaleLine> builder)
    {
        builder.ToTable("sale_lines", SalesSchema.Name, table =>
            table.HasCheckConstraint("CK_sale_lines_quantity", "\"Quantity\" > 0"));
        builder.HasKey(line => line.Id);
        builder.Property(line => line.Id).ValueGeneratedNever();
        builder.Property(line => line.ProductName).HasMaxLength(Product.NameMaxLength).IsRequired();
        builder.Property(line => line.SizeName).HasMaxLength(60).IsRequired();
        builder.Property(line => line.ColorName).HasMaxLength(60).IsRequired();
        builder.Property(line => line.Barcode).HasMaxLength(ProductVariant.BarcodeMaxLength).IsRequired();
        builder.Property(line => line.UnitPrice).HasPrecision(18, 2);
        builder.Property(line => line.LineTotalNio).HasPrecision(18, 2);
        builder.HasOne<ProductVariant>().WithMany().HasForeignKey(line => line.VariantId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(line => line.VariantId);
    }
}

public sealed class SalePaymentConfiguration : IEntityTypeConfiguration<SalePayment>
{
    public void Configure(EntityTypeBuilder<SalePayment> builder)
    {
        builder.ToTable("sale_payments", SalesSchema.Name, table =>
            table.HasCheckConstraint("CK_sale_payments_amount", "\"Amount\" > 0 AND \"AmountNio\" > 0"));
        builder.HasKey(payment => payment.Id);
        builder.Property(payment => payment.Id).ValueGeneratedNever();
        builder.Property(payment => payment.Method).HasConversion<string>().HasMaxLength(20);
        builder.Property(payment => payment.Currency).HasConversion<string>().HasMaxLength(3);
        builder.Property(payment => payment.Amount).HasPrecision(18, 2);
        builder.Property(payment => payment.ExchangeRate).HasPrecision(18, 4);
        builder.Property(payment => payment.AmountNio).HasPrecision(18, 2);
        builder.Property(payment => payment.Bank).HasMaxLength(100);
        builder.Property(payment => payment.Reference).HasMaxLength(100);
    }
}

public sealed class DiscountApprovalConfiguration : IEntityTypeConfiguration<DiscountApproval>
{
    public void Configure(EntityTypeBuilder<DiscountApproval> builder)
    {
        builder.ToTable("discount_approvals", SalesSchema.Name);
        builder.HasKey(approval => approval.Id);
        builder.Property(approval => approval.Id).ValueGeneratedNever();
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(approval => approval.ApproverUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<UserAccount>().WithMany().HasForeignKey(approval => approval.RequestedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
