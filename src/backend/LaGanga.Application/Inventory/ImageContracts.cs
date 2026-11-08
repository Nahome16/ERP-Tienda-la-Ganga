using LaGanga.Application.Common;

namespace LaGanga.Application.Inventory;

public sealed record ProductImageDto(Guid Id, string Url, string ThumbUrl, bool IsPrimary, int SortOrder);

public sealed record ReorderImagesRequest(IReadOnlyList<Guid>? ImageIds);

public static class MediaUrls
{
    public const string Prefix = "/api/v1/media/";

    public static string For(string fileName) => Prefix + fileName;
}

/// <summary>Almacén de archivos de imagen (en disco, en el volumen del servidor).</summary>
public interface IImageStorage
{
    Task SaveAsync(string fileName, ReadOnlyMemory<byte> content, CancellationToken cancellationToken);

    Stream? OpenRead(string fileName);

    Task DeleteAsync(string fileName, CancellationToken cancellationToken);
}

public interface IProductImageService
{
    Task<ServiceResult<ProductImageDto>> AddAsync(
        Guid productId,
        ReadOnlyMemory<byte> image,
        ReadOnlyMemory<byte> thumbnail,
        Actor actor,
        CancellationToken cancellationToken);

    Task<ServiceResult<IReadOnlyList<ProductImageDto>>> ReorderAsync(
        Guid productId,
        ReorderImagesRequest request,
        Actor actor,
        CancellationToken cancellationToken);

    Task<ServiceResult<bool>> DeleteAsync(
        Guid productId,
        Guid imageId,
        Actor actor,
        CancellationToken cancellationToken);
}
