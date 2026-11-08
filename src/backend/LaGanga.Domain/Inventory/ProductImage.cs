namespace LaGanga.Domain.Inventory;

/// <summary>
/// Imagen de un producto. El orden 0 es la imagen principal. Los archivos (imagen y
/// miniatura) viven en el almacenamiento de imágenes; aquí solo se guardan sus nombres.
/// </summary>
public sealed class ProductImage
{
    public const int MaxPerProduct = 4;
    public const int FileNameMaxLength = 64;

    private ProductImage()
    {
    }

    public ProductImage(
        Guid id,
        Guid productId,
        int sortOrder,
        string fileName,
        string thumbFileName,
        long sizeBytes,
        Guid? createdBy,
        DateTimeOffset createdAtUtc)
    {
        Id = id;
        ProductId = productId;
        SortOrder = sortOrder;
        FileName = fileName;
        ThumbFileName = thumbFileName;
        SizeBytes = sizeBytes;
        CreatedBy = createdBy;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid ProductId { get; private set; }

    public int SortOrder { get; set; }

    public string FileName { get; private set; } = string.Empty;

    public string ThumbFileName { get; private set; } = string.Empty;

    public long SizeBytes { get; private set; }

    public Guid? CreatedBy { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
