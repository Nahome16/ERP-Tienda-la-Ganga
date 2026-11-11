using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LaGanga.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// El pie del recibo por defecto decía «Recibo interno — no es factura». Se cambia solo si
    /// nadie lo personalizó en Configuración.
    /// </summary>
    public partial class ReceiptFooterWording : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE system.store_settings
                SET "ReceiptFooter" = 'Guarde este recibo para cualquier cambio.'
                WHERE "Id" = 1 AND "ReceiptFooter" = 'Recibo interno — no es factura';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE system.store_settings
                SET "ReceiptFooter" = 'Recibo interno — no es factura'
                WHERE "Id" = 1 AND "ReceiptFooter" = 'Guarde este recibo para cualquier cambio.';
                """);
        }
    }
}
