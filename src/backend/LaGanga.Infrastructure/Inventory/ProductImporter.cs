using System.Globalization;
using LaGanga.Application.Common;
using LaGanga.Application.Inventory;
using LaGanga.Domain.Catalog;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Inventory;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Inventory;

/// <summary>
/// Carga masiva desde filas de una hoja de cálculo. Todo o nada: si alguna fila
/// tiene error no se guarda nada; en modo de validación tampoco se guarda.
/// </summary>
internal sealed class ProductImporter(
    LaGangaDbContext dbContext,
    DateTimeOffset now,
    Actor actor,
    ImportRequest request)
{
    public const int MaxRows = 5000;

    private readonly List<ImportError> _errors = [];
    private readonly List<string> _catalogsCreated = [];
    private readonly Dictionary<string, Category> _categories = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Brand> _brands = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Cut> _cuts = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Size> _sizes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Color> _colors = new(StringComparer.Ordinal);

    public async Task<ImportResult> RunAsync(CancellationToken cancellationToken)
    {
        await LoadCatalogsAsync(cancellationToken);
        var existingBarcodes = (await dbContext.Variants.AsNoTracking().Select(variant => variant.Barcode).ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);
        var fileBarcodes = new HashSet<string>(StringComparer.Ordinal);
        var rows = request.Rows!;

        var groups = new Dictionary<string, ProductGroup>(StringComparer.Ordinal);
        for (var index = 0; index < rows.Count; index++)
        {
            var rowNumber = index + 1;
            var row = rows[index];
            var rowErrorsBefore = _errors.Count;

            var productName = CatalogText.CleanVisibleName(row.ProductName);
            if (productName.Length is 0 or > Product.NameMaxLength)
            {
                AddError(rowNumber, "El nombre del producto es obligatorio (máximo 200 caracteres).");
            }

            var category = ResolveCategory(rowNumber, row.Category, request.CreateMissingCatalogs);
            var brand = ResolveBrand(rowNumber, row.Brand, request.CreateMissingCatalogs);
            var cut = string.IsNullOrWhiteSpace(row.Cut) ? null : ResolveCut(rowNumber, row.Cut, request.CreateMissingCatalogs);
            var size = ResolveSize(rowNumber, row.Size, request.CreateMissingCatalogs);
            var color = ResolveColor(rowNumber, row.Color, request.CreateMissingCatalogs);

            if (row.Price is null or < 0)
            {
                AddError(rowNumber, "El precio es obligatorio y no puede ser negativo.");
            }

            if (row.Cost is < 0)
            {
                AddError(rowNumber, "El costo no puede ser negativo.");
            }
            else if (row.Cost is not null && !actor.CanSeeCosts)
            {
                AddError(rowNumber, "Tu cuenta no puede registrar costos: dejá esa columna vacía.");
            }

            var quantity = row.Quantity ?? 0;
            if (quantity < 0)
            {
                AddError(rowNumber, "La cantidad no puede ser negativa.");
            }
            else if (quantity > 0 && !actor.Has(PermissionNames.InventoryInitialConfirm))
            {
                AddError(rowNumber, "Tu cuenta no puede registrar existencia inicial.");
            }

            var barcode = row.Barcode?.Trim() ?? string.Empty;
            if (barcode.Length > 0)
            {
                if (!InventoryHelpers.IsBarcodeLegal(barcode))
                {
                    AddError(rowNumber, $"El código «{barcode}» no es válido (3 a 64 caracteres: letras, números, guion, punto o guion bajo).");
                }
                else if (existingBarcodes.Contains(barcode))
                {
                    AddError(rowNumber, $"El código «{barcode}» ya existe en el sistema.");
                }
                else if (!fileBarcodes.Add(barcode))
                {
                    AddError(rowNumber, $"El código «{barcode}» está repetido en el archivo.");
                }
            }

            if (_errors.Count != rowErrorsBefore || category is null || brand is null || size is null || color is null)
            {
                continue;
            }

            var key = string.Join('|', CatalogText.Normalize(productName), category.NormalizedName, brand.NormalizedName);
            if (!groups.TryGetValue(key, out var group))
            {
                group = new ProductGroup(productName, category, brand, cut, row.Price!.Value);
                groups[key] = group;
            }

            if (!group.Combos.Add((size.NormalizedName, color.NormalizedName)))
            {
                AddError(rowNumber, $"La combinación talla {size.Name} / color {color.Name} está repetida para «{productName}».");
                continue;
            }

            group.Variants.Add(new VariantRow(size, color, barcode, row.Price!.Value, row.Cost, quantity));
        }

        if (_errors.Count > 0)
        {
            return Summarize(0, 0, 0);
        }

        var productsCreated = 0;
        var variantsCreated = 0;
        var unitsLoaded = 0;
        foreach (var group in groups.Values)
        {
            productsCreated++;
            Product? product = null;
            if (!request.DryRun)
            {
                product = new Product(Guid.NewGuid(), group.Name, group.Category.Id, group.Brand.Id, group.Cut?.Id, group.BasePrice, actor.UserId, now);
                dbContext.Products.Add(product);
            }

            foreach (var variantRow in group.Variants)
            {
                variantsCreated++;
                unitsLoaded += variantRow.Quantity;
                if (product is null)
                {
                    continue;
                }

                var barcode = variantRow.Barcode.Length > 0
                    ? variantRow.Barcode
                    : await InventoryHelpers.NextBarcodeAsync(dbContext, cancellationToken);
                var priceOverride = variantRow.Price == group.BasePrice ? (decimal?)null : variantRow.Price;
                var variant = product.AddVariant(Guid.NewGuid(), variantRow.Size.Id, variantRow.Color.Id, barcode, priceOverride, variantRow.Cost, now);
                dbContext.Variants.Add(variant);
                dbContext.StockBalances.Add(new StockBalance(variant.Id, variantRow.Quantity));
                if (variantRow.Quantity > 0)
                {
                    dbContext.Movements.Add(new InventoryMovement(
                        Guid.NewGuid(), variant.Id, MovementType.InitialStock, variantRow.Quantity, variantRow.Quantity,
                        "Importación inicial", null, actor.UserId, now));
                }
            }
        }

        return Summarize(productsCreated, variantsCreated, unitsLoaded);
    }

    private ImportResult Summarize(int products, int variants, int units) =>
        new(request.DryRun, products, variants, units, _catalogsCreated, _errors);

    private void AddError(int row, string message) => _errors.Add(new ImportError(row, message));

    private async Task LoadCatalogsAsync(CancellationToken cancellationToken)
    {
        // Si hay nombres repetidos entre grupos, gana el de menor orden: es el primero de la lista.
        foreach (var category in await dbContext.Categories.AsNoTracking().OrderBy(c => c.ParentId == null).ThenBy(c => c.SortOrder).ToListAsync(cancellationToken))
        {
            _categories.TryAdd(category.NormalizedName, category);
        }

        foreach (var brand in await dbContext.Brands.AsNoTracking().ToListAsync(cancellationToken))
        {
            _brands.TryAdd(brand.NormalizedName, brand);
        }

        foreach (var cut in await dbContext.Cuts.AsNoTracking().ToListAsync(cancellationToken))
        {
            _cuts.TryAdd(cut.NormalizedName, cut);
        }

        foreach (var size in await dbContext.Sizes.AsNoTracking().OrderBy(s => s.SortOrder).ToListAsync(cancellationToken))
        {
            _sizes.TryAdd(size.NormalizedName, size);
        }

        foreach (var color in await dbContext.Colors.AsNoTracking().ToListAsync(cancellationToken))
        {
            _colors.TryAdd(color.NormalizedName, color);
        }
    }

    private Category? ResolveCategory(int row, string? name, bool create) =>
        Resolve(row, "categoría", name, _categories, create, "Categoría", clean => new Category(Guid.NewGuid(), clean, null, 0, actor.UserId, now));

    private Brand? ResolveBrand(int row, string? name, bool create) =>
        Resolve(row, "marca", name, _brands, create, "Marca", clean => new Brand(Guid.NewGuid(), clean, 0, actor.UserId, now));

    private Cut? ResolveCut(int row, string? name, bool create) =>
        Resolve(row, "corte", name, _cuts, create, "Corte", clean => new Cut(Guid.NewGuid(), clean, 0, actor.UserId, now));

    private Size? ResolveSize(int row, string? name, bool create) =>
        Resolve(row, "talla", name, _sizes, create, "Talla", clean => new Size(Guid.NewGuid(), clean, null, 0, actor.UserId, now));

    private Color? ResolveColor(int row, string? name, bool create) =>
        Resolve(row, "color", name, _colors, create, "Color", clean => new Color(Guid.NewGuid(), clean, null, 0, actor.UserId, now));

    private T? Resolve<T>(
        int row,
        string label,
        string? name,
        Dictionary<string, T> known,
        bool create,
        string createdLabel,
        Func<string, T> factory)
        where T : CatalogEntry
    {
        var clean = CatalogText.CleanVisibleName(name);
        if (clean.Length == 0)
        {
            AddError(row, $"Falta la {label}.");
            return null;
        }

        var normalized = CatalogText.Normalize(clean);
        if (known.TryGetValue(normalized, out var found))
        {
            return found;
        }

        if (!create)
        {
            AddError(row, $"La {label} «{clean}» no existe en los catálogos.");
            return null;
        }

        try
        {
            var entry = factory(clean);
            known[normalized] = entry;
            _catalogsCreated.Add(string.Create(CultureInfo.InvariantCulture, $"{createdLabel}: {entry.Name}"));
            if (!request.DryRun)
            {
                dbContext.Add(entry);
            }

            return entry;
        }
        catch (CatalogRuleException exception)
        {
            AddError(row, $"{char.ToUpperInvariant(label[0])}{label[1..]} «{clean}»: {exception.Message}");
            return null;
        }
    }

    private sealed class ProductGroup(string name, Category category, Brand brand, Cut? cut, decimal basePrice)
    {
        public string Name { get; } = name;

        public Category Category { get; } = category;

        public Brand Brand { get; } = brand;

        public Cut? Cut { get; } = cut;

        public decimal BasePrice { get; } = basePrice;

        public HashSet<(string, string)> Combos { get; } = [];

        public List<VariantRow> Variants { get; } = [];
    }

    private sealed record VariantRow(Size Size, Color Color, string Barcode, decimal Price, decimal? Cost, int Quantity);
}
