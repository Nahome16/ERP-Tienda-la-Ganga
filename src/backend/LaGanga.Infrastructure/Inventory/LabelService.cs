using LaGanga.Application.Common;
using LaGanga.Application.Inventory;
using LaGanga.Application.Settings;
using LaGanga.Domain.Inventory;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Inventory;

/// <summary>
/// Etiquetas de los códigos que generó el sistema (prendas que llegaron sin código de fábrica):
/// cuáles faltan imprimir y el registro de cada impresión.
/// </summary>
public sealed class LabelService : ILabelService
{
    /// <summary>Código interno generado: EAN-13 que empieza con «20» (ver <see cref="Ean13.FromSequence"/>).</summary>
    private const string GeneratedPattern = "20___________";

    private const int MaxCopies = 1000;

    private readonly LaGangaDbContext dbContext;
    private readonly IAuditWriter audit;
    private readonly TimeProvider timeProvider;

    public LabelService(LaGangaDbContext dbContext, IAuditWriter audit, TimeProvider timeProvider)
    {
        this.dbContext = dbContext;
        this.audit = audit;
        this.timeProvider = timeProvider;
    }

    public async Task<PageResult<LabelRowDto>> ListAsync(LabelQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var entryTypes = new[] { MovementType.InitialStock, MovementType.Entry };
        var search = query.Search?.Trim();
        var pattern = string.IsNullOrEmpty(search) ? null : $"%{search.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal)}%";

        // Código de todo el producto generado por el sistema: una sola etiqueta para todas sus tallas.
        var productRows = await (
            from product in dbContext.Products.AsNoTracking()
            where product.IsActive && product.Barcode != null && EF.Functions.Like(product.Barcode, GeneratedPattern)
            where pattern == null || EF.Functions.ILike(product.Name, pattern) || EF.Functions.ILike(product.Barcode!, pattern)
            select new
            {
                ProductId = product.Id,
                product.Name,
                Barcode = product.Barcode!,
                product.BasePrice,
                Stock = dbContext.StockBalances
                    .Where(balance => dbContext.Variants.Any(variant => variant.Id == balance.VariantId && variant.ProductId == product.Id))
                    .Sum(balance => (int?)balance.Quantity) ?? 0,
                ImageUrl = dbContext.ProductImages.Where(image => image.ProductId == product.Id)
                    .OrderBy(image => image.SortOrder).Select(image => MediaUrls.Prefix + image.ThumbFileName).FirstOrDefault(),
                LastPrint = dbContext.LabelPrints.Where(print => print.ProductId == product.Id && print.VariantId == null)
                    .OrderByDescending(print => print.PrintedAtUtc).Select(print => new { print.PrintedAtUtc, print.Copies }).FirstOrDefault(),
                LastEntry = dbContext.Movements
                    .Where(movement => entryTypes.Contains(movement.Type) && movement.Quantity > 0 &&
                        dbContext.Variants.Any(variant => variant.Id == movement.VariantId && variant.ProductId == product.Id))
                    .Max(movement => (DateTimeOffset?)movement.CreatedAtUtc),
            }).ToListAsync(cancellationToken);

        // Tallas y colores con código generado de productos que no traen ningún código de fábrica
        // (ni del producto ni del color): cada prenda necesita su etiqueta.
        var variantRows = await (
            from variant in dbContext.Variants.AsNoTracking()
            join product in dbContext.Products on variant.ProductId equals product.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            join balance in dbContext.StockBalances on variant.Id equals balance.VariantId into balances
            from balance in balances.DefaultIfEmpty()
            where variant.IsActive && product.IsActive && product.Barcode == null &&
                EF.Functions.Like(variant.Barcode, GeneratedPattern) &&
                !dbContext.ProductColorBarcodes.Any(code => code.ProductId == product.Id && code.ColorId == variant.ColorId)
            where pattern == null || EF.Functions.ILike(product.Name, pattern) || EF.Functions.ILike(variant.Barcode, pattern) ||
                EF.Functions.ILike(size.Name, pattern) || EF.Functions.ILike(color.Name, pattern)
            select new
            {
                ProductId = product.Id,
                VariantId = variant.Id,
                product.Name,
                SizeName = size.Name,
                SizeOrder = size.SortOrder,
                ColorName = color.Name,
                ColorHex = color.SwatchHex,
                variant.Barcode,
                Price = variant.PriceOverride ?? product.BasePrice,
                Stock = balance == null ? 0 : balance.Quantity,
                ImageUrl = dbContext.ProductImages.Where(image => image.ProductId == product.Id)
                    .OrderBy(image => image.SortOrder).Select(image => MediaUrls.Prefix + image.ThumbFileName).FirstOrDefault(),
                LastPrint = dbContext.LabelPrints.Where(print => print.VariantId == variant.Id)
                    .OrderByDescending(print => print.PrintedAtUtc).Select(print => new { print.PrintedAtUtc, print.Copies }).FirstOrDefault(),
                LastEntry = dbContext.Movements
                    .Where(movement => movement.VariantId == variant.Id && entryTypes.Contains(movement.Type) && movement.Quantity > 0)
                    .Max(movement => (DateTimeOffset?)movement.CreatedAtUtc),
            }).ToListAsync(cancellationToken);

        static bool IsPending(int stock, DateTimeOffset? lastPrint, DateTimeOffset? lastEntry) =>
            stock > 0 && (lastPrint is null || (lastEntry is not null && lastEntry > lastPrint));

        var rows = productRows
            .Select(row => new LabelRowDto(
                row.ProductId, null, row.Name, null, null, null, row.Barcode, row.BasePrice, row.Stock, row.ImageUrl,
                row.LastPrint?.PrintedAtUtc, row.LastPrint?.Copies ?? 0, IsPending(row.Stock, row.LastPrint?.PrintedAtUtc, row.LastEntry)))
            .Concat(variantRows
                .OrderBy(row => row.Name).ThenBy(row => row.ColorName).ThenBy(row => row.SizeOrder)
                .Select(row => new LabelRowDto(
                    row.ProductId, row.VariantId, row.Name, row.SizeName, row.ColorName, row.ColorHex, row.Barcode, row.Price, row.Stock, row.ImageUrl,
                    row.LastPrint?.PrintedAtUtc, row.LastPrint?.Copies ?? 0, IsPending(row.Stock, row.LastPrint?.PrintedAtUtc, row.LastEntry))));

        rows = query.Status?.Trim().ToUpperInvariant() switch
        {
            "PRINTED" => rows.Where(row => !row.Pending && row.LastPrintedAtUtc is not null),
            "ALL" => rows,
            _ => rows.Where(row => row.Pending),
        };

        var ordered = rows
            .OrderBy(row => row.ProductName, StringComparer.Create(System.Globalization.CultureInfo.GetCultureInfo("es"), ignoreCase: true))
            .ThenBy(row => row.VariantId is null ? 0 : 1)
            .ToList();
        var items = ordered.Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToList();
        return Paging.Create(items, query.Page, query.PageSize, ordered.Count);
    }

    public async Task<ServiceResult<int>> MarkPrintedAsync(LabelPrintedInput input, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(actor);

        var items = input.Items ?? [];
        if (items.Count is 0 or > 500 || items.Any(item => item.Copies is < 0 or > MaxCopies))
        {
            return Result.Fail<int>(ServiceErrorKind.Validation, "validation_failed", "Indicá entre 1 y 500 etiquetas impresas, con 0 a 1000 copias cada una.", "items");
        }

        var productIds = items.Select(item => item.ProductId).Distinct().ToArray();
        var variantIds = items.Where(item => item.VariantId is not null).Select(item => item.VariantId!.Value).Distinct().ToArray();
        var knownProducts = await dbContext.Products.Where(product => productIds.Contains(product.Id)).Select(product => product.Id).ToListAsync(cancellationToken);
        var knownVariants = await dbContext.Variants.Where(variant => variantIds.Contains(variant.Id))
            .Select(variant => new { variant.Id, variant.ProductId }).ToListAsync(cancellationToken);
        if (knownProducts.Count != productIds.Length ||
            items.Any(item => item.VariantId is { } id && !knownVariants.Any(variant => variant.Id == id && variant.ProductId == item.ProductId)))
        {
            return Result.Fail<int>(ServiceErrorKind.NotFound, "not_found", "Alguno de los productos ya no existe. Recargá la lista.");
        }

        var now = timeProvider.GetUtcNow();
        foreach (var item in items)
        {
            dbContext.LabelPrints.Add(new LabelPrint(Guid.NewGuid(), item.ProductId, item.VariantId, item.Copies, actor.UserId, now));
        }

        var copies = items.Sum(item => item.Copies);
        audit.Add(actor.UserId, "labels.printed", "Product", productIds.Length == 1 ? productIds[0].ToString() : "varios", $"{copies} etiqueta(s) impresas de {items.Count} código(s).");
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Ok(items.Count);
    }
}
