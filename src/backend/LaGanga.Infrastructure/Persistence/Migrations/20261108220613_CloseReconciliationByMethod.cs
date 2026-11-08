using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LaGanga.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CloseReconciliationByMethod : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "CountedCardNio",
                schema: "sales",
                table: "cash_sessions",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CountedCardUsd",
                schema: "sales",
                table: "cash_sessions",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CountedTransferNio",
                schema: "sales",
                table: "cash_sessions",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CountedTransferUsd",
                schema: "sales",
                table: "cash_sessions",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CountedCardNio",
                schema: "sales",
                table: "cash_sessions");

            migrationBuilder.DropColumn(
                name: "CountedCardUsd",
                schema: "sales",
                table: "cash_sessions");

            migrationBuilder.DropColumn(
                name: "CountedTransferNio",
                schema: "sales",
                table: "cash_sessions");

            migrationBuilder.DropColumn(
                name: "CountedTransferUsd",
                schema: "sales",
                table: "cash_sessions");
        }
    }
}
