using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LaGanga.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLabelPrints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "label_prints",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    VariantId = table.Column<Guid>(type: "uuid", nullable: true),
                    Copies = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    PrintedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_label_prints", x => x.Id);
                    table.CheckConstraint("CK_label_prints_copies", "\"Copies\" >= 0");
                    table.ForeignKey(
                        name: "FK_label_prints_product_variants_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "inventory",
                        principalTable: "product_variants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_label_prints_products_ProductId",
                        column: x => x.ProductId,
                        principalSchema: "inventory",
                        principalTable: "products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_label_prints_ProductId_PrintedAtUtc",
                schema: "inventory",
                table: "label_prints",
                columns: new[] { "ProductId", "PrintedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_label_prints_VariantId",
                schema: "inventory",
                table: "label_prints",
                column: "VariantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "label_prints",
                schema: "inventory");
        }
    }
}
