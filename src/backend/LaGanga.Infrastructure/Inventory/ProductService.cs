using System.Globalization;
using LaGanga.Application.Common;
using LaGanga.Application.Inventory;
using LaGanga.Application.Settings;
using LaGanga.Domain.Catalog;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Inventory;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Inventory;

public sealed class ProductService : IProductService
{
    private readonly LaGangaDbContext dbContext;
    private readonly IAuditWriter audit;
    private readonly TimeProvider timeProvider;
    private readonly LotService lots;

    public ProductService(LaGangaDbContext dbContext, IAuditWriter audit, TimeProvider timeProvider)
    {
        this.dbContext = dbContext;
        this.audit = audit;
        this.timeProvider = timeProvider;
        lots = new LotService(dbContext);
    }

    public async Task<PageResult<ProductListItemDto>> ListAsync(
        ProductListQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var products = dbContext.Products.AsNoTracking().AsQueryable();
        switch (query.Status?.Trim().ToUpperInvariant())
        {
            case "ACTIVE":
                products = products.Where(product => product.IsActive);
                break;
            case "INACTIVE":
                products = products.Where(product => !product.IsActive);
                break;
        }

        if (query.CategoryId is { } categoryId)
        {
            products = products.Where(product => product.CategoryId == categoryId);
        }

        if (query.BrandId is { } brandId)
        {
            products = products.Where(product => product.BrandId == brandId);
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var pattern = $"%{EscapeLike(query.Search.Trim())}%";
            products = products.Where(product =>
                EF.Functions.ILike(product.Name, pattern) ||
                dbContext.Brands.Any(brand => brand.Id == product.BrandId && EF.Functions.ILike(brand.Name, pattern)) ||
                dbContext.Variants.Any(variant => variant.ProductId == product.Id && EF.Functions.ILike(variant.Barcode, pattern)));
        }

        var total = await products.CountAsync(cancellationToken);
        var items = await (
            from product in products.OrderBy(p => p.Name).ThenBy(p => p.Id)
                .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            join category in dbContext.Categories on product.CategoryId equals category.Id
            join brand in dbContext.Brands on product.BrandId equals brand.Id
            join cut in dbContext.Cuts on product.CutId equals cut.Id into cuts
            from cut in cuts.DefaultIfEmpty()
            orderby product.Name, product.Id
            select new ProductListItemDto(
                product.Id,
                product.Name,
                category.Id,
                category.Name,
                brand.Id,
                brand.Name,
                cut == null ? null : cut.Id,
                cut == null ? null : cut.Name,
                product.BasePrice,
                product.IsActive,
                dbContext.Variants.Count(variant => variant.ProductId == product.Id),
                dbContext.StockBalances
                    .Where(balance => dbContext.Variants.Any(variant => variant.Id == balance.VariantId && variant.ProductId == product.Id))
                    .Sum(balance => (int?)balance.Quantity) ?? 0,
                product.Version,
                dbContext.ProductImages.Where(image => image.ProductId == product.Id)
                    .OrderBy(image => image.SortOrder).Select(image => MediaUrls.Prefix + image.ThumbFileName).FirstOrDefault()))
            .ToListAsync(cancellationToken);
        return Paging.Create(items, query.Page, query.PageSize, total);
    }

    public async Task<ServiceResult<ProductDetailDto>> GetAsync(Guid id, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var detail = await LoadDetailAsync(id, actor.CanSeeCosts, cancellationToken);
        return detail is null ? NotFound() : Result.Ok(detail);
    }

    public async Task<ServiceResult<ProductDetailDto>> CreateAsync(
        CreateProductInput input,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var name = CatalogText.CleanVisibleName(input.Name);
        if (name.Length is 0 or > Product.NameMaxLength)
        {
            return Invalid("name", $"El nombre es obligatorio (máximo {Product.NameMaxLength} caracteres).");
        }

        if (input.BasePrice is null or < 0)
        {
            return Invalid("basePrice", "El precio base es obligatorio y no puede ser negativo.");
        }

        if (input.Variants is not { Count: > 0 })
        {
            return Invalid("variants", "Agregá al menos una variante (talla y color).");
        }

        var referenceError = await ValidateReferencesAsync(input.CategoryId, input.BrandId, input.CutId, cancellationToken);
        if (referenceError is not null)
        {
            return Result.Fail<ProductDetailDto>(referenceError);
        }

        var variantError = await ValidateNewVariantsAsync(input.Variants, actor, cancellationToken);
        if (variantError is not null)
        {
            return Result.Fail<ProductDetailDto>(variantError);
        }

        var now = timeProvider.GetUtcNow();
        var today = BusinessTime.ToBusinessDate(now);
        if (input.ReceivedOn is { } receivedOn && (receivedOn > today || receivedOn < today.AddDays(-MaxReceivedDaysBack)))
        {
            return Invalid("receivedOn", $"La fecha de ingreso no puede ser futura ni de hace más de {MaxReceivedDaysBack} días.");
        }

        var received = ReceivedMoment(input.ReceivedOn, today, now);
        var product = new Product(
            Guid.NewGuid(), name, input.CategoryId, input.BrandId, input.CutId, input.BasePrice.Value, actor.UserId, now);
        dbContext.Products.Add(product);
        foreach (var variantInput in input.Variants)
        {
            await AddVariantCoreAsync(product, variantInput, actor, now, cancellationToken, received);
        }

        audit.Add(actor.UserId, "product.created", "Product", product.Id.ToString(), $"Producto «{product.Name}» con {input.Variants.Count} variante(s).");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (InventoryHelpers.IsUniqueViolation(exception))
        {
            return DuplicateFrom(exception);
        }

        var detail = await LoadDetailAsync(product.Id, actor.CanSeeCosts, cancellationToken);
        return Result.Ok(detail!);
    }

    public async Task<ServiceResult<ProductDetailDto>> UpdateAsync(
        Guid id,
        long expectedVersion,
        UpdateProductInput input,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var product = await dbContext.Products.SingleOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);
        if (product is null)
        {
            return NotFound();
        }

        if (product.Version != expectedVersion)
        {
            return VersionConflict();
        }

        var name = CatalogText.CleanVisibleName(input.Name);
        if (name.Length is 0 or > Product.NameMaxLength)
        {
            return Invalid("name", $"El nombre es obligatorio (máximo {Product.NameMaxLength} caracteres).");
        }

        if (input.BasePrice is null or < 0)
        {
            return Invalid("basePrice", "El precio base es obligatorio y no puede ser negativo.");
        }

        var referenceError = await ValidateReferencesAsync(input.CategoryId, input.BrandId, input.CutId, cancellationToken);
        if (referenceError is not null)
        {
            return Result.Fail<ProductDetailDto>(referenceError);
        }

        product.Update(
            name,
            input.CategoryId,
            input.BrandId,
            input.CutId,
            input.BasePrice.Value,
            input.IsActive ?? product.IsActive,
            actor.UserId,
            timeProvider.GetUtcNow());
        audit.Add(actor.UserId, "product.updated", "Product", product.Id.ToString(), $"Producto «{product.Name}» actualizado (precio {product.BasePrice}, {(product.IsActive ? "activo" : "inactivo")}).");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return VersionConflict();
        }

        return Result.Ok((await LoadDetailAsync(id, actor.CanSeeCosts, cancellationToken))!);
    }

    public async Task<ServiceResult<ProductDetailDto>> AddVariantAsync(
        Guid productId,
        NewVariantInput input,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var product = await dbContext.Products.SingleOrDefaultAsync(candidate => candidate.Id == productId, cancellationToken);
        if (product is null)
        {
            return NotFound();
        }

        var error = await ValidateNewVariantsAsync([input], actor, cancellationToken);
        if (error is not null)
        {
            return Result.Fail<ProductDetailDto>(error);
        }

        if (await dbContext.Variants.AnyAsync(
                variant => variant.ProductId == productId && variant.SizeId == input.SizeId && variant.ColorId == input.ColorId,
                cancellationToken))
        {
            return Result.Fail<ProductDetailDto>(ServiceErrorKind.Conflict, "duplicate_variant", "Ese producto ya tiene una variante con esa talla y color.");
        }

        var now = timeProvider.GetUtcNow();
        await AddVariantCoreAsync(product, input, actor, now, cancellationToken);
        audit.Add(actor.UserId, "product.updated", "Product", product.Id.ToString(), $"Variante agregada a «{product.Name}».");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (InventoryHelpers.IsUniqueViolation(exception))
        {
            return DuplicateFrom(exception);
        }

        return Result.Ok((await LoadDetailAsync(productId, actor.CanSeeCosts, cancellationToken))!);
    }

    public async Task<ServiceResult<VariantDto>> UpdateVariantAsync(
        Guid variantId,
        long expectedVersion,
        UpdateVariantInput input,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var variant = await dbContext.Variants.SingleOrDefaultAsync(candidate => candidate.Id == variantId, cancellationToken);
        if (variant is null)
        {
            return Result.Fail<VariantDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa variante.");
        }

        if (variant.Version != expectedVersion)
        {
            return Result.Fail<VariantDto>(ServiceErrorKind.Conflict, "version_conflict", "Otra persona modificó esta variante. Recargá y volvé a intentar.");
        }

        var barcode = input.Barcode?.Trim() ?? string.Empty;
        if (!InventoryHelpers.IsBarcodeLegal(barcode))
        {
            return Result.Fail<VariantDto>(ServiceErrorKind.Validation, "validation_failed", "El código de barras debe tener entre 3 y 64 caracteres (letras, números, guion, punto o guion bajo).", "barcode");
        }

        if (input.PriceOverride is < 0 || input.Cost is < 0)
        {
            return Result.Fail<VariantDto>(ServiceErrorKind.Validation, "validation_failed", "Los importes no pueden ser negativos.", input.Cost is < 0 ? "cost" : "priceOverride");
        }

        if (!string.Equals(barcode, variant.Barcode, StringComparison.Ordinal) &&
            await dbContext.Variants.AnyAsync(other => other.Barcode == barcode && other.Id != variantId, cancellationToken))
        {
            return Result.Fail<VariantDto>(ServiceErrorKind.Conflict, "duplicate_barcode", "Ese código de barras ya pertenece a otra variante.", "barcode");
        }

        // Quien no puede ver costos no los modifica: se conserva el costo actual.
        var cost = actor.CanSeeCosts ? input.Cost : variant.Cost;
        variant.Update(barcode, input.PriceOverride, cost, input.IsActive ?? variant.IsActive);
        audit.Add(actor.UserId, "product.updated", "Variant", variant.Id.ToString(), $"Variante {barcode} actualizada.");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Result.Fail<VariantDto>(ServiceErrorKind.Conflict, "version_conflict", "Otra persona modificó esta variante. Recargá y volvé a intentar.");
        }
        catch (DbUpdateException exception) when (InventoryHelpers.IsUniqueViolation(exception))
        {
            return Result.Fail<VariantDto>(ServiceErrorKind.Conflict, "duplicate_barcode", "Ese código de barras ya pertenece a otra variante.", "barcode");
        }

        var lookup = await FindByBarcodeAsync(barcode, actor, cancellationToken);
        return lookup.Succeeded ? Result.Ok(lookup.Value!.Variant) : Result.Fail<VariantDto>(lookup.Error!);
    }

    public async Task<ServiceResult<VariantLookupDto>> FindByBarcodeAsync(
        string barcode,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var code = barcode?.Trim() ?? string.Empty;
        var row = await (
            from variant in dbContext.Variants.AsNoTracking()
            where variant.Barcode == code
            join product in dbContext.Products on variant.ProductId equals product.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            join balance in dbContext.StockBalances on variant.Id equals balance.VariantId into balances
            from balance in balances.DefaultIfEmpty()
            select new { variant, product.Name, product.BasePrice, SizeName = size.Name, ColorName = color.Name, color.SwatchHex, Stock = balance == null ? 0 : balance.Quantity })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return Result.Fail<VariantLookupDto>(ServiceErrorKind.NotFound, "barcode_not_found", "No encontramos ningún producto con ese código de barras.");
        }

        return Result.Ok(new VariantLookupDto(
            row.Name,
            InventoryHelpers.ToDto(row.variant, row.BasePrice, row.SizeName, row.ColorName, row.SwatchHex, row.Stock, actor.CanSeeCosts)));
    }

    public async Task<ServiceResult<ImportResult>> ImportAsync(
        ImportRequest request,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        if (request.Rows is not { Count: > 0 })
        {
            return Result.Fail<ImportResult>(ServiceErrorKind.Validation, "validation_failed", "El archivo no tiene filas para importar.", "rows");
        }

        if (request.Rows.Count > ProductImporter.MaxRows)
        {
            return Result.Fail<ImportResult>(ServiceErrorKind.Validation, "validation_failed", $"Importá como máximo {ProductImporter.MaxRows} filas por archivo.", "rows");
        }

        var importer = new ProductImporter(dbContext, lots, timeProvider.GetUtcNow(), actor, request);
        var result = await importer.RunAsync(cancellationToken);
        if (!request.DryRun && result.Errors.Count == 0)
        {
            audit.Add(actor.UserId, "product.imported", "Product", "import", $"Importación: {result.ProductsCreated} productos, {result.VariantsCreated} variantes, {result.UnitsLoaded} unidades.");
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception) when (InventoryHelpers.IsUniqueViolation(exception))
            {
                return Result.Fail<ImportResult>(ServiceErrorKind.Conflict, "duplicate_barcode", "Algún código de barras ya existe. Volvé a validar el archivo.");
            }
        }

        return Result.Ok(result);
    }

    private async Task<ServiceError?> ValidateReferencesAsync(
        Guid categoryId,
        Guid brandId,
        Guid? cutId,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.Categories.AnyAsync(category => category.Id == categoryId, cancellationToken))
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "Elegí una categoría válida.", "categoryId");
        }

        if (!await dbContext.Brands.AnyAsync(brand => brand.Id == brandId, cancellationToken))
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "Elegí una marca válida.", "brandId");
        }

        if (cutId is { } cut && !await dbContext.Cuts.AnyAsync(candidate => candidate.Id == cut, cancellationToken))
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "El corte elegido no existe.", "cutId");
        }

        return null;
    }

    private async Task<ServiceError?> ValidateNewVariantsAsync(
        IReadOnlyList<NewVariantInput> variants,
        Actor actor,
        CancellationToken cancellationToken)
    {
        var seenCombos = new HashSet<(Guid, Guid)>();
        var seenBarcodes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var variant in variants)
        {
            if (!seenCombos.Add((variant.SizeId, variant.ColorId)))
            {
                return new ServiceError(ServiceErrorKind.Conflict, "duplicate_variant", "Hay dos variantes con la misma talla y color.", "variants");
            }

            if (variant.PriceOverride is < 0 || variant.Cost is < 0)
            {
                return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "Los importes no pueden ser negativos.", "variants");
            }

            if (variant.Cost is not null && !actor.CanSeeCosts)
            {
                return new ServiceError(ServiceErrorKind.Forbidden, "cost_not_allowed", "Tu cuenta no puede registrar costos.", "variants");
            }

            if (variant.InitialQuantity < 0)
            {
                return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "La cantidad inicial no puede ser negativa.", "variants");
            }

            if (variant.InitialQuantity > 0 && !actor.Has(PermissionNames.InventoryInitialConfirm))
            {
                return new ServiceError(ServiceErrorKind.Forbidden, "initial_stock_not_allowed", "Tu cuenta no puede registrar existencia inicial.", "variants");
            }

            if (variant.PartnerId is { } partnerId)
            {
                if (!actor.Has(PermissionNames.InvestmentRead))
                {
                    return new ServiceError(ServiceErrorKind.Forbidden, "partner_not_allowed", "Tu cuenta no puede asignar un socio a la mercadería.", "variants");
                }

                if (!await dbContext.Partners.AnyAsync(partner => partner.Id == partnerId && partner.IsActive, cancellationToken))
                {
                    return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "El socio elegido no existe o está inactivo.", "variants");
                }
            }

            var barcode = variant.Barcode?.Trim() ?? string.Empty;
            if (barcode.Length > 0)
            {
                if (!InventoryHelpers.IsBarcodeLegal(barcode))
                {
                    return new ServiceError(ServiceErrorKind.Validation, "validation_failed", $"El código «{barcode}» no es válido (3 a 64 caracteres: letras, números, guion, punto o guion bajo).", "variants");
                }

                if (!seenBarcodes.Add(barcode))
                {
                    return new ServiceError(ServiceErrorKind.Conflict, "duplicate_barcode", $"El código «{barcode}» está repetido.", "variants");
                }

                if (await dbContext.Variants.AnyAsync(existing => existing.Barcode == barcode, cancellationToken))
                {
                    return new ServiceError(ServiceErrorKind.Conflict, "duplicate_barcode", $"El código «{barcode}» ya pertenece a otra variante.", "variants");
                }
            }
        }

        var sizeIds = variants.Select(variant => variant.SizeId).Distinct().ToArray();
        var colorIds = variants.Select(variant => variant.ColorId).Distinct().ToArray();
        if (await dbContext.Sizes.CountAsync(size => sizeIds.Contains(size.Id), cancellationToken) != sizeIds.Length)
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "Alguna talla elegida no existe.", "variants");
        }

        if (await dbContext.Colors.CountAsync(color => colorIds.Contains(color.Id), cancellationToken) != colorIds.Length)
        {
            return new ServiceError(ServiceErrorKind.Validation, "validation_failed", "Algún color elegido no existe.", "variants");
        }

        return null;
    }

    private async Task AddVariantCoreAsync(
        Product product,
        NewVariantInput input,
        Actor actor,
        DateTimeOffset now,
        CancellationToken cancellationToken,
        (DateTimeOffset EnteredAtUtc, string Note)? received = null)
    {
        var barcode = input.Barcode?.Trim() ?? string.Empty;
        if (barcode.Length == 0)
        {
            barcode = await InventoryHelpers.NextBarcodeAsync(dbContext, cancellationToken);
        }

        var variant = product.AddVariant(Guid.NewGuid(), input.SizeId, input.ColorId, barcode, input.PriceOverride, input.Cost, now);
        dbContext.Variants.Add(variant);
        dbContext.StockBalances.Add(new StockBalance(variant.Id, input.InitialQuantity));
        if (input.InitialQuantity > 0)
        {
            dbContext.Movements.Add(new InventoryMovement(
                Guid.NewGuid(), variant.Id, MovementType.InitialStock, input.InitialQuantity, input.InitialQuantity,
                received?.Note ?? "Existencia inicial", null, actor.UserId, now));
            lots.AddLot(
                variant.Id, input.PartnerId, LotSource.InitialStock, input.InitialQuantity, 0,
                input.Cost, input.PriceOverride ?? product.BasePrice, received?.Note ?? "Existencia inicial", actor.UserId, received?.EnteredAtUtc ?? now);
        }
    }

    /// <summary>Días hacia atrás que se acepta como fecha de ingreso de la mercadería.</summary>
    private const int MaxReceivedDaysBack = 365;

    /// <summary>
    /// Momento de la entrada (PEPS) para una fecha de ingreso anterior a hoy: el mediodía de ese día en
    /// Managua. Hoy o sin fecha: el momento actual. El Kardex siempre guarda cuándo se registró.
    /// </summary>
    private static (DateTimeOffset EnteredAtUtc, string Note)? ReceivedMoment(DateOnly? receivedOn, DateOnly today, DateTimeOffset now)
    {
        if (receivedOn is not { } date || date >= today)
        {
            return null;
        }

        var note = string.Create(CultureInfo.InvariantCulture, $"Existencia inicial (ingresó el {date:dd/MM/yyyy})");
        var enteredAt = BusinessTime.DayRangeUtc(date).StartUtc.AddHours(12);
        return (enteredAt < now ? enteredAt : now, note);
    }

    private async Task<ProductDetailDto?> LoadDetailAsync(Guid id, bool includeCost, CancellationToken cancellationToken)
    {
        var product = await dbContext.Products.AsNoTracking()
            .Include(candidate => candidate.Variants)
            .SingleOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);
        if (product is null)
        {
            return null;
        }

        var categoryName = await dbContext.Categories.Where(category => category.Id == product.CategoryId).Select(category => category.Name).SingleAsync(cancellationToken);
        var brandName = await dbContext.Brands.Where(brand => brand.Id == product.BrandId).Select(brand => brand.Name).SingleAsync(cancellationToken);
        var cutName = product.CutId is { } cutId
            ? await dbContext.Cuts.Where(cut => cut.Id == cutId).Select(cut => cut.Name).SingleOrDefaultAsync(cancellationToken)
            : null;

        var variantIds = product.Variants.Select(variant => variant.Id).ToArray();
        var sizeIds = product.Variants.Select(variant => variant.SizeId).Distinct().ToArray();
        var colorIds = product.Variants.Select(variant => variant.ColorId).Distinct().ToArray();
        var sizes = await dbContext.Sizes.AsNoTracking().Where(size => sizeIds.Contains(size.Id)).ToDictionaryAsync(size => size.Id, cancellationToken);
        var colors = await dbContext.Colors.AsNoTracking().Where(color => colorIds.Contains(color.Id)).ToDictionaryAsync(color => color.Id, cancellationToken);
        var stocks = await dbContext.StockBalances.AsNoTracking().Where(balance => variantIds.Contains(balance.VariantId))
            .ToDictionaryAsync(balance => balance.VariantId, balance => balance.Quantity, cancellationToken);

        var variants = product.Variants
            .OrderBy(variant => sizes[variant.SizeId].SortOrder)
            .ThenBy(variant => sizes[variant.SizeId].Name, StringComparer.Ordinal)
            .ThenBy(variant => colors[variant.ColorId].Name, StringComparer.Ordinal)
            .Select(variant => InventoryHelpers.ToDto(
                variant,
                product.BasePrice,
                sizes[variant.SizeId].Name,
                colors[variant.ColorId].Name,
                colors[variant.ColorId].SwatchHex,
                stocks.GetValueOrDefault(variant.Id),
                includeCost))
            .ToArray();

        var images = (await dbContext.ProductImages.AsNoTracking().Where(image => image.ProductId == id)
            .OrderBy(image => image.SortOrder).ToListAsync(cancellationToken))
            .Select(image => ProductImageService.ToDto(image, image.SortOrder == 0)).ToArray();

        return new ProductDetailDto(
            product.Id,
            product.Name,
            product.CategoryId,
            categoryName,
            product.BrandId,
            brandName,
            product.CutId,
            cutName,
            product.BasePrice,
            product.IsActive,
            variants.Length,
            variants.Sum(variant => variant.Stock),
            product.Version,
            images.FirstOrDefault()?.ThumbUrl,
            variants,
            images);
    }

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);

    private static ServiceResult<ProductDetailDto> Invalid(string field, string message) =>
        Result.Fail<ProductDetailDto>(ServiceErrorKind.Validation, "validation_failed", message, field);

    private static ServiceResult<ProductDetailDto> NotFound() =>
        Result.Fail<ProductDetailDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos ese producto.");

    private static ServiceResult<ProductDetailDto> VersionConflict() =>
        Result.Fail<ProductDetailDto>(ServiceErrorKind.Conflict, "version_conflict", "Otra persona modificó este producto. Recargá y volvé a intentar.");

    private static ServiceResult<ProductDetailDto> DuplicateFrom(DbUpdateException exception) =>
        InventoryHelpers.IsUniqueViolation(exception, InventoryHelpers.VariantIndex)
            ? Result.Fail<ProductDetailDto>(ServiceErrorKind.Conflict, "duplicate_variant", "Hay variantes repetidas (misma talla y color).")
            : Result.Fail<ProductDetailDto>(ServiceErrorKind.Conflict, "duplicate_barcode", "Algún código de barras ya pertenece a otra variante.");
}
