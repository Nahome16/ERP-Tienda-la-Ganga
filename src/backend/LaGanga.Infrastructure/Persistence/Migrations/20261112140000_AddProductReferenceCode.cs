using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LaGanga.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddProductReferenceCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ReferenceCode",
                schema: "inventory",
                table: "products",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_products_ReferenceCode",
                schema: "inventory",
                table: "products",
                column: "ReferenceCode");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_products_ReferenceCode",
                schema: "inventory",
                table: "products");

            migrationBuilder.DropColumn(
                name: "ReferenceCode",
                schema: "inventory",
                table: "products");
        }
    }
}
