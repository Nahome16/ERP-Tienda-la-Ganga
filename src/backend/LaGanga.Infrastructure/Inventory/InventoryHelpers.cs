using LaGanga.Application.Inventory;
using LaGanga.Domain.Inventory;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LaGanga.Infrastructure.Inventory;

internal static class InventoryHelpers
{
    public const string BarcodeIndex = "IX_product_variants_Barcode";
    public const string VariantIndex = "IX_product_variants_ProductId_SizeId_ColorId";

    public static bool IsBarcodeLegal(string barcode) =>
        barcode.Length is >= 3 and <= ProductVariant.BarcodeMaxLength &&
        barcode.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '.' or '_');

    public static bool IsUniqueViolation(DbUpdateException exception, string? constraint = null) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg &&
        (constraint is null || string.Equals(pg.ConstraintName, constraint, StringComparison.Ordinal));

    public static async Task<string> NextBarcodeAsync(LaGangaDbContext dbContext, CancellationToken cancellationToken)
    {
        // Se reintenta si alguien ya registró a mano un código igual al generado.
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var sequence = await dbContext.Database
                .SqlQueryRaw<long>("SELECT nextval('inventory.barcode_seq') AS \"Value\"")
                .SingleAsync(cancellationToken);
            var barcode = Ean13.FromSequence(sequence);
            if (!await dbContext.Variants.AnyAsync(variant => variant.Barcode == barcode, cancellationToken))
            {
                return barcode;
            }
        }

        throw new InvalidOperationException("No fue posible generar un código de barras único.");
    }

    public static VariantDto ToDto(
        ProductVariant variant,
        decimal basePrice,
        string sizeName,
        string colorName,
        string? colorHex,
        int stock,
        bool includeCost) =>
        new(
            variant.Id,
            variant.ProductId,
            variant.SizeId,
            sizeName,
            variant.ColorId,
            colorName,
            colorHex,
            variant.Barcode,
            variant.PriceOverride,
            variant.PriceOverride ?? basePrice,
            stock,
            variant.IsActive,
            variant.Version,
            includeCost ? variant.Cost : null);
}
