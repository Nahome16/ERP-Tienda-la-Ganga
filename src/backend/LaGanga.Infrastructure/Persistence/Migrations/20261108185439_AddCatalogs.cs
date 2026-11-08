using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LaGanga.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCatalogs : Migration
    {
        private static readonly string[] CategoryParentNameColumns =
            ["ParentId", "NormalizedName"];

        private static readonly string[] SizeGroupNameColumns =
            ["SizeGroupId", "NormalizedName"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "catalog");

            migrationBuilder.CreateTable(
                name: "brands",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_brands", x => x.Id);
                    table.CheckConstraint("CK_brands_sort_order", "\"SortOrder\" >= 0");
                    table.ForeignKey(
                        name: "FK_brands_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_brands_users_UpdatedBy",
                        column: x => x.UpdatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "categories",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_categories", x => x.Id);
                    table.CheckConstraint("CK_categories_not_own_parent", "\"ParentId\" IS NULL OR \"ParentId\" <> \"Id\"");
                    table.CheckConstraint("CK_categories_sort_order", "\"SortOrder\" >= 0");
                    table.ForeignKey(
                        name: "FK_categories_categories_ParentId",
                        column: x => x.ParentId,
                        principalSchema: "catalog",
                        principalTable: "categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_categories_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_categories_users_UpdatedBy",
                        column: x => x.UpdatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "colors",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SwatchHex = table.Column<string>(type: "character(7)", fixedLength: true, maxLength: 7, nullable: true),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_colors", x => x.Id);
                    table.CheckConstraint("CK_colors_sort_order", "\"SortOrder\" >= 0");
                    table.CheckConstraint("CK_colors_swatch_hex", "\"SwatchHex\" IS NULL OR \"SwatchHex\" ~ '^#[0-9A-F]{6}$'");
                    table.ForeignKey(
                        name: "FK_colors_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_colors_users_UpdatedBy",
                        column: x => x.UpdatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "cuts",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cuts", x => x.Id);
                    table.CheckConstraint("CK_cuts_sort_order", "\"SortOrder\" >= 0");
                    table.ForeignKey(
                        name: "FK_cuts_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_cuts_users_UpdatedBy",
                        column: x => x.UpdatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "size_groups",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_size_groups", x => x.Id);
                    table.CheckConstraint("CK_size_groups_sort_order", "\"SortOrder\" >= 0");
                    table.ForeignKey(
                        name: "FK_size_groups_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_size_groups_users_UpdatedBy",
                        column: x => x.UpdatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "sizes",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SizeGroupId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sizes", x => x.Id);
                    table.CheckConstraint("CK_sizes_sort_order", "\"SortOrder\" >= 0");
                    table.ForeignKey(
                        name: "FK_sizes_size_groups_SizeGroupId",
                        column: x => x.SizeGroupId,
                        principalSchema: "catalog",
                        principalTable: "size_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_sizes_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_sizes_users_UpdatedBy",
                        column: x => x.UpdatedBy,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_brands_CreatedBy",
                schema: "catalog",
                table: "brands",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_brands_NormalizedName",
                schema: "catalog",
                table: "brands",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_brands_UpdatedBy",
                schema: "catalog",
                table: "brands",
                column: "UpdatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_categories_CreatedBy",
                schema: "catalog",
                table: "categories",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_categories_ParentId_NormalizedName",
                schema: "catalog",
                table: "categories",
                columns: CategoryParentNameColumns,
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_categories_UpdatedBy",
                schema: "catalog",
                table: "categories",
                column: "UpdatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_colors_CreatedBy",
                schema: "catalog",
                table: "colors",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_colors_NormalizedName",
                schema: "catalog",
                table: "colors",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_colors_UpdatedBy",
                schema: "catalog",
                table: "colors",
                column: "UpdatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_cuts_CreatedBy",
                schema: "catalog",
                table: "cuts",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_cuts_NormalizedName",
                schema: "catalog",
                table: "cuts",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_cuts_UpdatedBy",
                schema: "catalog",
                table: "cuts",
                column: "UpdatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_size_groups_CreatedBy",
                schema: "catalog",
                table: "size_groups",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_size_groups_NormalizedName",
                schema: "catalog",
                table: "size_groups",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_size_groups_UpdatedBy",
                schema: "catalog",
                table: "size_groups",
                column: "UpdatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_sizes_CreatedBy",
                schema: "catalog",
                table: "sizes",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_sizes_SizeGroupId_NormalizedName",
                schema: "catalog",
                table: "sizes",
                columns: SizeGroupNameColumns,
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_sizes_UpdatedBy",
                schema: "catalog",
                table: "sizes",
                column: "UpdatedBy");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "brands",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "categories",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "colors",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "cuts",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "sizes",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "size_groups",
                schema: "catalog");
        }
    }
}
