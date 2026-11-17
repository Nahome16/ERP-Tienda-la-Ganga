using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LaGanga.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSaleShipping : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ShippingNio",
                schema: "sales",
                table: "sales",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "ShippingDestination",
                schema: "sales",
                table: "sales",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ShippingRecipient",
                schema: "sales",
                table: "sales",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ShippingPhone",
                schema: "sales",
                table: "sales",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ShippingCarrier",
                schema: "sales",
                table: "sales",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_sales_shipping",
                schema: "sales",
                table: "sales",
                sql: "\"ShippingNio\" >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_sales_shipping",
                schema: "sales",
                table: "sales");

            migrationBuilder.DropColumn(name: "ShippingNio", schema: "sales", table: "sales");
            migrationBuilder.DropColumn(name: "ShippingDestination", schema: "sales", table: "sales");
            migrationBuilder.DropColumn(name: "ShippingRecipient", schema: "sales", table: "sales");
            migrationBuilder.DropColumn(name: "ShippingPhone", schema: "sales", table: "sales");
            migrationBuilder.DropColumn(name: "ShippingCarrier", schema: "sales", table: "sales");
        }
    }
}
