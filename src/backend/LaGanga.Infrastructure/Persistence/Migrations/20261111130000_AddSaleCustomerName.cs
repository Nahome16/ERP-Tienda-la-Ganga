using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LaGanga.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSaleCustomerName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CustomerName",
                schema: "sales",
                table: "sales",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CustomerName",
                schema: "sales",
                table: "sales");
        }
    }
}
