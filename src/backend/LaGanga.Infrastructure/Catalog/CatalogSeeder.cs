using LaGanga.Domain.Catalog;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Catalog;

/// <summary>
/// Carga los valores iniciales documentados en la especificación del Módulo 1
/// (sección 4). Cada catálogo se carga solo si está vacío, así que se puede
/// ejecutar varias veces sin duplicar ni pisar cambios hechos por la tienda.
/// </summary>
public sealed class CatalogSeeder(LaGangaDbContext dbContext, TimeProvider timeProvider)
{
    private static readonly string[] Brands =
    [
        "Sin marca", "Zolo Jeans", "Kalua", "Pop Sugar", "Most Wanted", "Chic Mi", "JINGO",
        "Hummer", "Levi’s", "Tesoro", "Denim Lover", "Monday", "Soho", "Zara", "Morelli",
        "Polo", "Gold Rose", "Never Legal",
    ];

    private static readonly string[] Cuts =
    [
        "Straight Fit", "Skinny", "Flare", "Wide Leg", "Palazzo", "Mom Jeans", "Slim", "Baggy",
    ];

    private static readonly (string Group, string[] Sizes)[] SizeGroups =
    [
        ("Dama normal", ["3", "5", "7", "9", "11", "13"]),
        ("Dama especial", ["15", "17", "19", "21", "23", "25"]),
        ("Caballero", ["30", "32", "34", "36", "38", "40", "42", "44"]),
        ("Juvenil", ["10", "12", "14", "16"]),
        ("Camisas", ["S", "M", "L", "XL", "1XL", "2XL", "3XL"]),
    ];

    /// <summary>
    /// Paleta de colores de ropa con su tono. Es la misma lista que usa el panel
    /// (src/frontend/la-ganga-web/src/lib/colorPalette.ts); si cambia una, cambiar la otra.
    /// </summary>
    internal static readonly (string Name, string Hex)[] Colors =
    [
        ("Negro", "#111111"),
        ("Blanco", "#FFFFFF"),
        ("Hueso", "#F2EBDD"),
        ("Crema", "#F3E5C3"),
        ("Beige", "#D9C3A0"),
        ("Caqui", "#B5A36E"),
        ("Camel", "#B9874B"),
        ("Café", "#6B4226"),
        ("Chocolate", "#4A2C1D"),
        ("Gris claro", "#C9C9C9"),
        ("Gris", "#8A8A8A"),
        ("Gris oscuro", "#4A4A4A"),
        ("Plomo", "#5E6670"),
        ("Azul", "#1F5FBF"),
        ("Azul claro", "#7FB2E5"),
        ("Azul oscuro", "#1B2F5C"),
        ("Azul marino", "#14213D"),
        ("Celeste", "#9CD3F0"),
        ("Turquesa", "#2BB7B3"),
        ("Petróleo", "#1F5A66"),
        ("Mezclilla", "#3E5F8A"),
        ("Verde", "#2E8B57"),
        ("Verde claro", "#9BD39B"),
        ("Verde oscuro", "#1F4D2E"),
        ("Verde olivo", "#6B7A3A"),
        ("Verde menta", "#A8E6CF"),
        ("Amarillo", "#F2C531"),
        ("Mostaza", "#C99A2E"),
        ("Naranja", "#EE7A2B"),
        ("Coral", "#F2786B"),
        ("Rojo", "#C62828"),
        ("Vino", "#6D1A2B"),
        ("Terracota", "#B5543A"),
        ("Rosa", "#F2A2B8"),
        ("Rosa palo", "#E8C4C4"),
        ("Fucsia", "#D6247A"),
        ("Lila", "#C3A6D8"),
        ("Morado", "#6A3D9A"),
        ("Dorado", "#C9A13B"),
        ("Plateado", "#BFC4C9"),
        ("Multicolor", "#9B7BD1"),
    ];

    private static readonly (string Root, string[] Children)[] Categories =
    [
        ("Dama", ["Pantalones", "Blusas", "Camisas"]),
        ("Caballero", ["Pantalones", "Camisas"]),
        ("Juvenil", ["Pantalones", "Blusas", "Camisas"]),
        ("Niños", ["Pantalones", "Camisas"]),
    ];

    public async Task<int> SeedAsync(Guid? createdBy, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();

        if (!await dbContext.Brands.AnyAsync(cancellationToken))
        {
            dbContext.Brands.AddRange(Brands.Select((name, index) =>
                new Brand(Guid.NewGuid(), name, (index + 1) * 10, createdBy, now)));
        }

        if (!await dbContext.Cuts.AnyAsync(cancellationToken))
        {
            dbContext.Cuts.AddRange(Cuts.Select((name, index) =>
                new Cut(Guid.NewGuid(), name, (index + 1) * 10, createdBy, now)));
        }

        if (!await dbContext.SizeGroups.AnyAsync(cancellationToken) &&
            !await dbContext.Sizes.AnyAsync(cancellationToken))
        {
            for (var groupIndex = 0; groupIndex < SizeGroups.Length; groupIndex++)
            {
                var (groupName, sizes) = SizeGroups[groupIndex];
                var group = new SizeGroup(Guid.NewGuid(), groupName, (groupIndex + 1) * 10, createdBy, now);
                dbContext.SizeGroups.Add(group);
                dbContext.Sizes.AddRange(sizes.Select((size, sizeIndex) =>
                    new Size(Guid.NewGuid(), size, group.Id, (sizeIndex + 1) * 10, createdBy, now)));
            }
        }

        await SeedColorsAsync(createdBy, now, cancellationToken);

        if (!await dbContext.Categories.AnyAsync(cancellationToken))
        {
            for (var rootIndex = 0; rootIndex < Categories.Length; rootIndex++)
            {
                var (rootName, children) = Categories[rootIndex];
                var root = new Category(Guid.NewGuid(), rootName, null, (rootIndex + 1) * 10, createdBy, now);
                dbContext.Categories.Add(root);
                dbContext.Categories.AddRange(children.Select((child, childIndex) =>
                    new Category(Guid.NewGuid(), child, root.Id, (childIndex + 1) * 10, createdBy, now)));
            }
        }

        return await dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Agrega los colores de la paleta que falten (comparando nombres sin tildes ni
    /// mayúsculas, también contra los inactivos) y pone el tono a los colores de la
    /// paleta que no lo tienen. No cambia un tono que la tienda ya eligió.
    /// </summary>
    private async Task SeedColorsAsync(Guid? createdBy, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var existing = await dbContext.Colors.ToListAsync(cancellationToken);
        var byName = existing
            .GroupBy(color => color.NormalizedName, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var nextOrder = existing.Count == 0 ? 10 : existing.Max(color => color.SortOrder) + 10;
        for (var index = 0; index < Colors.Length; index++)
        {
            var (name, hex) = Colors[index];
            if (byName.TryGetValue(CatalogText.Normalize(name), out var color))
            {
                if (color.SwatchHex is null)
                {
                    color.ChangeSwatch(hex, createdBy, now);
                }

                continue;
            }

            var order = existing.Count == 0 ? (index + 1) * 10 : nextOrder;
            nextOrder += 10;
            dbContext.Colors.Add(new Color(Guid.NewGuid(), name, hex, order, createdBy, now));
        }
    }
}
