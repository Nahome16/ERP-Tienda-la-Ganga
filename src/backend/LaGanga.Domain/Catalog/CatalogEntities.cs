using System.Buffers;

namespace LaGanga.Domain.Catalog;

public sealed class Brand : CatalogEntry
{
    public const int NameMaxLength = 100;

    private Brand()
    {
    }

    public Brand(Guid id, string name, int sortOrder, Guid? createdBy, DateTimeOffset createdAtUtc)
        : base(id, name, sortOrder, createdBy, createdAtUtc)
    {
    }
}

public sealed class Cut : CatalogEntry
{
    public const int NameMaxLength = 100;

    private Cut()
    {
    }

    public Cut(Guid id, string name, int sortOrder, Guid? createdBy, DateTimeOffset createdAtUtc)
        : base(id, name, sortOrder, createdBy, createdAtUtc)
    {
    }
}

public sealed class SizeGroup : CatalogEntry
{
    public const int NameMaxLength = 100;

    private SizeGroup()
    {
    }

    public SizeGroup(Guid id, string name, int sortOrder, Guid? createdBy, DateTimeOffset createdAtUtc)
        : base(id, name, sortOrder, createdBy, createdAtUtc)
    {
    }
}

public sealed class Category : CatalogEntry
{
    public const int NameMaxLength = 100;

    private Category()
    {
    }

    public Category(
        Guid id,
        string name,
        Guid? parentId,
        int sortOrder,
        Guid? createdBy,
        DateTimeOffset createdAtUtc)
        : base(id, name, sortOrder, createdBy, createdAtUtc)
    {
        SetParent(parentId);
    }

    public Guid? ParentId { get; private set; }

    /// <summary>
    /// Cambia la categoría superior. Quien llama debe comprobar antes con
    /// <see cref="CategoryHierarchy.WouldCreateCycle"/> que no se forma un ciclo.
    /// </summary>
    public void ChangeParent(Guid? parentId, Guid? updatedBy, DateTimeOffset updatedAtUtc)
    {
        if (ParentId == parentId)
        {
            return;
        }

        SetParent(parentId);
        Touch(updatedBy, updatedAtUtc);
    }

    private void SetParent(Guid? parentId)
    {
        if (parentId == Id)
        {
            throw new CatalogRuleException(
                "category_cycle",
                "Una categoría no puede estar dentro de sí misma.");
        }

        ParentId = parentId;
    }
}

public sealed class Size : CatalogEntry
{
    public const int NameMaxLength = 30;

    private Size()
    {
    }

    public Size(
        Guid id,
        string name,
        Guid? sizeGroupId,
        int sortOrder,
        Guid? createdBy,
        DateTimeOffset createdAtUtc)
        : base(id, name, sortOrder, createdBy, createdAtUtc)
    {
        SizeGroupId = sizeGroupId;
    }

    public Guid? SizeGroupId { get; private set; }

    public void ChangeGroup(Guid? sizeGroupId, Guid? updatedBy, DateTimeOffset updatedAtUtc)
    {
        if (SizeGroupId == sizeGroupId)
        {
            return;
        }

        SizeGroupId = sizeGroupId;
        Touch(updatedBy, updatedAtUtc);
    }
}

public sealed class Color : CatalogEntry
{
    public const int NameMaxLength = 60;

    private static readonly SearchValues<char> HexDigits =
        SearchValues.Create("0123456789abcdefABCDEF");

    private Color()
    {
    }

    public Color(
        Guid id,
        string name,
        string? swatchHex,
        int sortOrder,
        Guid? createdBy,
        DateTimeOffset createdAtUtc)
        : base(id, name, sortOrder, createdBy, createdAtUtc)
    {
        SwatchHex = NormalizeSwatch(swatchHex);
    }

    /// <summary>Muestra visual opcional en formato #RRGGBB.</summary>
    public string? SwatchHex { get; private set; }

    public void ChangeSwatch(string? swatchHex, Guid? updatedBy, DateTimeOffset updatedAtUtc)
    {
        var normalized = NormalizeSwatch(swatchHex);
        if (string.Equals(SwatchHex, normalized, StringComparison.Ordinal))
        {
            return;
        }

        SwatchHex = normalized;
        Touch(updatedBy, updatedAtUtc);
    }

    public static string? NormalizeSwatch(string? swatchHex)
    {
        if (string.IsNullOrWhiteSpace(swatchHex))
        {
            return null;
        }

        var value = swatchHex.Trim();
        var isValid = value.Length == 7 &&
            value[0] == '#' &&
            value.AsSpan(1).IndexOfAnyExcept(HexDigits) < 0;
        if (!isValid)
        {
            throw new CatalogRuleException(
                "invalid_swatch",
                "La muestra de color debe tener el formato #RRGGBB.");
        }

        return value.ToUpperInvariant();
    }
}
