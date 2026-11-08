using System.Text.RegularExpressions;
using LaGanga.Application.Common;
using LaGanga.Application.Inventory;
using LaGanga.Application.Settings;
using LaGanga.Domain.Inventory;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace LaGanga.Infrastructure.Inventory;

/// <summary>Guarda las imágenes en una carpeta del servidor. Solo acepta nombres generados por el sistema.</summary>
public sealed partial class LocalImageStorage : IImageStorage
{
    private readonly string _root;

    public LocalImageStorage(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var configured = configuration["Storage:ImagesPath"];
        _root = Path.GetFullPath(string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(AppContext.BaseDirectory, "data", "images")
            : configured);
    }

    public static bool IsValidName(string? fileName) =>
        fileName is { Length: <= ProductImage.FileNameMaxLength } && ValidName().IsMatch(fileName);

    public async Task SaveAsync(string fileName, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_root);
        var path = PathFor(fileName);
        var temp = path + ".tmp";
        await File.WriteAllBytesAsync(temp, content.ToArray(), cancellationToken);
        File.Move(temp, path, overwrite: true);
    }

    public Stream? OpenRead(string fileName)
    {
        if (!IsValidName(fileName))
        {
            return null;
        }

        var path = PathFor(fileName);
        return File.Exists(path) ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true) : null;
    }

    public Task DeleteAsync(string fileName, CancellationToken cancellationToken)
    {
        if (IsValidName(fileName))
        {
            var path = PathFor(fileName);
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }

        return Task.CompletedTask;
    }

    [GeneratedRegex(@"^[0-9a-f]{32}(_t)?\.(jpg|png|webp)$", RegexOptions.CultureInvariant)]
    private static partial Regex ValidName();

    private string PathFor(string fileName)
    {
        if (!IsValidName(fileName))
        {
            throw new ArgumentException("Nombre de archivo no válido.", nameof(fileName));
        }

        return Path.Combine(_root, fileName);
    }
}

public sealed class ProductImageService(
    LaGangaDbContext dbContext,
    IImageStorage storage,
    IAuditWriter audit,
    TimeProvider timeProvider) : IProductImageService
{
    public const int MaxImageBytes = 2_621_440;
    public const int MaxThumbBytes = 409_600;

    public async Task<ServiceResult<ProductImageDto>> AddAsync(
        Guid productId,
        ReadOnlyMemory<byte> image,
        ReadOnlyMemory<byte> thumbnail,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var product = await dbContext.Products.AsNoTracking().SingleOrDefaultAsync(candidate => candidate.Id == productId, cancellationToken);
        if (product is null)
        {
            return Result.Fail<ProductImageDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos ese producto.");
        }

        if (image.Length is 0 || image.Length > MaxImageBytes)
        {
            return Invalid($"La imagen debe pesar menos de {MaxImageBytes / 1_048_576.0:0.#} MB.");
        }

        if (thumbnail.Length is 0 || thumbnail.Length > MaxThumbBytes)
        {
            return Invalid("La miniatura falta o es demasiado pesada.");
        }

        var imageKind = ImageSniffer.Detect(image.Span);
        var thumbKind = ImageSniffer.Detect(thumbnail.Span);
        if (imageKind is null || thumbKind is null || thumbKind == ImageKind.Png && thumbnail.Length > 150_000)
        {
            return Invalid("El archivo no es una imagen válida (usá JPG, PNG o WebP).");
        }

        var existing = await dbContext.ProductImages.Where(candidate => candidate.ProductId == productId).ToListAsync(cancellationToken);
        if (existing.Count >= ProductImage.MaxPerProduct)
        {
            return Result.Fail<ProductImageDto>(ServiceErrorKind.Conflict, "image_limit", $"Cada producto admite hasta {ProductImage.MaxPerProduct} imágenes.");
        }

        var id = Guid.NewGuid();
        var fileName = $"{id:N}.{ImageSniffer.Extension(imageKind.Value)}";
        var thumbName = $"{id:N}_t.{ImageSniffer.Extension(thumbKind.Value)}";
        await storage.SaveAsync(fileName, image, cancellationToken);
        await storage.SaveAsync(thumbName, thumbnail, cancellationToken);

        var order = existing.Count == 0 ? 0 : existing.Max(candidate => candidate.SortOrder) + 1;
        var entity = new ProductImage(id, productId, order, fileName, thumbName, image.Length + thumbnail.Length, actor.UserId, timeProvider.GetUtcNow());
        dbContext.ProductImages.Add(entity);
        audit.Add(actor.UserId, "product.updated", "Product", productId.ToString(), $"Imagen agregada a «{product.Name}».");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            await storage.DeleteAsync(fileName, CancellationToken.None);
            await storage.DeleteAsync(thumbName, CancellationToken.None);
            throw;
        }

        return Result.Ok(ToDto(entity, order == 0));
    }

    public async Task<ServiceResult<IReadOnlyList<ProductImageDto>>> ReorderAsync(
        Guid productId,
        ReorderImagesRequest request,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        var images = await dbContext.ProductImages.Where(candidate => candidate.ProductId == productId).ToListAsync(cancellationToken);
        var requested = request.ImageIds ?? [];
        if (requested.Count != images.Count ||
            requested.Distinct().Count() != requested.Count ||
            requested.Any(id => images.All(image => image.Id != id)))
        {
            return Result.Fail<IReadOnlyList<ProductImageDto>>(
                ServiceErrorKind.Validation, "validation_failed", "El orden debe incluir exactamente las imágenes del producto.", "imageIds");
        }

        for (var index = 0; index < requested.Count; index++)
        {
            images.Single(image => image.Id == requested[index]).SortOrder = index;
        }

        audit.Add(actor.UserId, "product.updated", "Product", productId.ToString(), "Orden de imágenes actualizado.");
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Ok<IReadOnlyList<ProductImageDto>>(
            images.OrderBy(image => image.SortOrder).Select(image => ToDto(image, image.SortOrder == 0)).ToArray());
    }

    public async Task<ServiceResult<bool>> DeleteAsync(
        Guid productId,
        Guid imageId,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var images = await dbContext.ProductImages.Where(candidate => candidate.ProductId == productId)
            .OrderBy(candidate => candidate.SortOrder).ToListAsync(cancellationToken);
        var target = images.SingleOrDefault(candidate => candidate.Id == imageId);
        if (target is null)
        {
            return Result.Fail<bool>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa imagen.");
        }

        dbContext.ProductImages.Remove(target);
        var order = 0;
        foreach (var remaining in images.Where(candidate => candidate.Id != imageId))
        {
            remaining.SortOrder = order++;
        }

        audit.Add(actor.UserId, "product.updated", "Product", productId.ToString(), "Imagen eliminada.");
        await dbContext.SaveChangesAsync(cancellationToken);
        await storage.DeleteAsync(target.FileName, cancellationToken);
        await storage.DeleteAsync(target.ThumbFileName, cancellationToken);
        return Result.Ok(true);
    }

    internal static ProductImageDto ToDto(ProductImage image, bool isPrimary) =>
        new(image.Id, MediaUrls.For(image.FileName), MediaUrls.For(image.ThumbFileName), isPrimary, image.SortOrder);

    private static ServiceResult<ProductImageDto> Invalid(string message) =>
        Result.Fail<ProductImageDto>(ServiceErrorKind.Unprocessable, "invalid_image", message);
}
