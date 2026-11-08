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

    private static readonly string[] Colors =
    [
        "Negro", "Azul", "Azul oscuro", "Azul claro", "Celeste", "Petróleo", "Caqui", "Beige",
        "Café", "Gris",
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

        if (!await dbContext.Colors.AnyAsync(cancellationToken))
        {
            dbContext.Colors.AddRange(Colors.Select((name, index) =>
                new Color(Guid.NewGuid(), name, null, (index + 1) * 10, createdBy, now)));
        }

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
}
