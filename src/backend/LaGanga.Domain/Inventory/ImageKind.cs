namespace LaGanga.Domain.Inventory;

public enum ImageKind
{
    Jpeg,
    Png,
    WebP,
}

/// <summary>Reconoce el tipo real de una imagen por su firma, sin confiar en el nombre ni el tipo declarado.</summary>
public static class ImageSniffer
{
    public static ImageKind? Detect(ReadOnlySpan<byte> data)
    {
        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
        {
            return ImageKind.Jpeg;
        }

        ReadOnlySpan<byte> png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (data.Length >= 8 && data[..8].SequenceEqual(png))
        {
            return ImageKind.Png;
        }

        if (data.Length >= 12 &&
            data[..4].SequenceEqual("RIFF"u8) &&
            data.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return ImageKind.WebP;
        }

        return null;
    }

    public static string Extension(ImageKind kind) =>
        kind switch
        {
            ImageKind.Jpeg => "jpg",
            ImageKind.Png => "png",
            _ => "webp",
        };

    public static string ContentType(string extension) =>
        extension switch
        {
            "jpg" => "image/jpeg",
            "png" => "image/png",
            _ => "image/webp",
        };
}
