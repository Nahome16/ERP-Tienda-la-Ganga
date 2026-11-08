using LaGanga.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LaGanga.Infrastructure.Persistence;

public sealed class UserAccountConfiguration : IEntityTypeConfiguration<UserAccount>
{
    public void Configure(EntityTypeBuilder<UserAccount> builder)
    {
        builder.ToTable("users", "identity");
        builder.HasKey(user => user.Id);
        builder.Property(user => user.Username).HasMaxLength(64).IsRequired();
        builder.Property(user => user.NormalizedUsername).HasMaxLength(64).IsRequired();
        builder.Property(user => user.DisplayName).HasMaxLength(120).IsRequired();
        builder.Property(user => user.PasswordHash).HasMaxLength(512).IsRequired();
        builder.Property(user => user.SecurityStamp).HasMaxLength(64).IsRequired();
        builder.HasIndex(user => user.NormalizedUsername).IsUnique();
        builder.HasMany(user => user.Roles)
            .WithOne(userRole => userRole.User)
            .HasForeignKey(userRole => userRole.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class RoleConfiguration : IEntityTypeConfiguration<Role>
{
    public void Configure(EntityTypeBuilder<Role> builder)
    {
        builder.ToTable("roles", "identity");
        builder.HasKey(role => role.Id);
        builder.Property(role => role.Name).HasMaxLength(80).IsRequired();
        builder.Property(role => role.NormalizedName).HasMaxLength(80).IsRequired();
        builder.HasIndex(role => role.NormalizedName).IsUnique();
        builder.HasMany(role => role.Permissions)
            .WithOne(rolePermission => rolePermission.Role)
            .HasForeignKey(rolePermission => rolePermission.RoleId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class PermissionConfiguration : IEntityTypeConfiguration<PermissionGrant>
{
    public void Configure(EntityTypeBuilder<PermissionGrant> builder)
    {
        builder.ToTable("permissions", "identity");
        builder.HasKey(permission => permission.Id);
        builder.Property(permission => permission.Name).HasMaxLength(120).IsRequired();
        builder.HasIndex(permission => permission.Name).IsUnique();
    }
}

public sealed class UserRoleConfiguration : IEntityTypeConfiguration<UserRole>
{
    public void Configure(EntityTypeBuilder<UserRole> builder)
    {
        builder.ToTable("user_roles", "identity");
        builder.HasKey(userRole => new { userRole.UserId, userRole.RoleId });
        builder.HasOne(userRole => userRole.Role)
            .WithMany()
            .HasForeignKey(userRole => userRole.RoleId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class RolePermissionConfiguration : IEntityTypeConfiguration<RolePermissionGrant>
{
    public void Configure(EntityTypeBuilder<RolePermissionGrant> builder)
    {
        builder.ToTable("role_permissions", "identity");
        builder.HasKey(rolePermission => new { rolePermission.RoleId, rolePermission.PermissionId });
        builder.HasOne(rolePermission => rolePermission.Permission)
            .WithMany()
            .HasForeignKey(rolePermission => rolePermission.PermissionId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class UserSessionConfiguration : IEntityTypeConfiguration<UserSession>
{
    public void Configure(EntityTypeBuilder<UserSession> builder)
    {
        builder.ToTable("sessions", "identity");
        builder.HasKey(session => session.Id);
        builder.Property(session => session.TokenIdentifier).HasMaxLength(64).IsRequired();
        builder.Property(session => session.CsrfTokenHash).HasMaxLength(64).IsRequired();
        builder.Property(session => session.RevokedReason).HasMaxLength(120);
        builder.HasIndex(session => session.TokenIdentifier).IsUnique();
        builder.HasIndex(session => new { session.UserId, session.RevokedAtUtc });
        builder.HasOne(session => session.User)
            .WithMany()
            .HasForeignKey(session => session.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
