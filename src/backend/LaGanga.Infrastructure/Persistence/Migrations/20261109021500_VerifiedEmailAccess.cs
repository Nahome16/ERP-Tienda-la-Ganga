using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LaGanga.Infrastructure.Persistence.Migrations;

[DbContext(typeof(LaGangaDbContext))]
[Migration("20261109021500_VerifiedEmailAccess")]
public sealed class VerifiedEmailAccess : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(name: "Email", schema: "identity", table: "users", type: "character varying(254)", maxLength: 254, nullable: true);
        migrationBuilder.AddColumn<bool>(name: "MustChangePassword", schema: "identity", table: "users", type: "boolean", nullable: false, defaultValue: false);
        migrationBuilder.AddColumn<string>(name: "NormalizedEmail", schema: "identity", table: "users", type: "character varying(254)", maxLength: 254, nullable: true);
        migrationBuilder.AddColumn<string>(name: "VerificationCodeHash", schema: "identity", table: "users", type: "character varying(512)", maxLength: 512, nullable: true);
        migrationBuilder.AddColumn<DateTimeOffset>(name: "VerificationCodeIssuedAtUtc", schema: "identity", table: "users", type: "timestamp with time zone", nullable: true);
        migrationBuilder.AddColumn<DateTimeOffset>(name: "VerificationCodeExpiresAtUtc", schema: "identity", table: "users", type: "timestamp with time zone", nullable: true);
        migrationBuilder.AddColumn<int>(name: "VerificationCodeFailedAttempts", schema: "identity", table: "users", type: "integer", nullable: false, defaultValue: 0);
        migrationBuilder.AddColumn<DateTimeOffset>(name: "VerificationCodeConsumedAtUtc", schema: "identity", table: "users", type: "timestamp with time zone", nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_users_NormalizedEmail",
            schema: "identity",
            table: "users",
            column: "NormalizedEmail",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "IX_users_NormalizedEmail", schema: "identity", table: "users");
        migrationBuilder.DropColumn(name: "Email", schema: "identity", table: "users");
        migrationBuilder.DropColumn(name: "MustChangePassword", schema: "identity", table: "users");
        migrationBuilder.DropColumn(name: "NormalizedEmail", schema: "identity", table: "users");
        migrationBuilder.DropColumn(name: "VerificationCodeHash", schema: "identity", table: "users");
        migrationBuilder.DropColumn(name: "VerificationCodeIssuedAtUtc", schema: "identity", table: "users");
        migrationBuilder.DropColumn(name: "VerificationCodeExpiresAtUtc", schema: "identity", table: "users");
        migrationBuilder.DropColumn(name: "VerificationCodeFailedAttempts", schema: "identity", table: "users");
        migrationBuilder.DropColumn(name: "VerificationCodeConsumedAtUtc", schema: "identity", table: "users");
    }
}
