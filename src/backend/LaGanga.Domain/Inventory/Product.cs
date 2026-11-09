namespace LaGanga.Domain.Inventory;

public sealed class Product
{
    public const int NameMaxLength = 200;

    private readonly List<ProductVariant> _variants = [];

    private Product()
    {
    }

    public Product(
        Guid id,
        string name,
        Guid categoryId,
        Guid brandId,
        Guid? cutId,
        decimal basePrice,
        Guid? createdBy,
        DateTimeOffset createdAtUtc)
    {
        Id = id;
        Name = name.Trim();
        CategoryId = categoryId;
        BrandId = brandId;
        CutId = cutId;
        BasePrice = basePrice;
        IsActive = true;
        CreatedAtUtc = createdAtUtc;
        CreatedBy = createdBy;
        UpdatedAtUtc = createdAtUtc;
        UpdatedBy = createdBy;
        Version = 1;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public Guid CategoryId { get; private set; }

    public Guid BrandId { get; private set; }

    public Guid? CutId { get; private set; }

    public decimal BasePrice { get; private set; }

    public bool IsActive { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public Guid? CreatedBy { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public Guid? UpdatedBy { get; private set; }

    public long Version { get; private set; }

    public IReadOnlyCollection<ProductVariant> Variants => _variants;

    public void Update(
        string name,
        Guid categoryId,
        Guid brandId,
        Guid? cutId,
        decimal basePrice,
        bool isActive,
        Guid? updatedBy,
        DateTimeOffset updatedAtUtc)
    {
        Name = name.Trim();
        CategoryId = categoryId;
        BrandId = brandId;
        CutId = cutId;
        BasePrice = basePrice;
        IsActive = isActive;
        UpdatedBy = updatedBy;
        UpdatedAtUtc = updatedAtUtc;
    }

    public ProductVariant AddVariant(
        Guid id,
        Guid sizeId,
        Guid colorId,
        string barcode,
        decimal? priceOverride,
        decimal? cost,
        DateTimeOffset createdAtUtc)
    {
        var variant = new ProductVariant(id, Id, sizeId, colorId, barcode, priceOverride, cost, createdAtUtc);
        _variants.Add(variant);
        return variant;
    }
}

public sealed class ProductVariant
{
    public const int BarcodeMaxLength = 64;

    private ProductVariant()
    {
    }

    internal ProductVariant(
        Guid id,
        Guid productId,
        Guid sizeId,
        Guid colorId,
        string barcode,
        decimal? priceOverride,
        decimal? cost,
        DateTimeOffset createdAtUtc)
    {
        Id = id;
        ProductId = productId;
        SizeId = sizeId;
        ColorId = colorId;
        Barcode = barcode;
        PriceOverride = priceOverride;
        Cost = cost;
        IsActive = true;
        CreatedAtUtc = createdAtUtc;
        Version = 1;
    }

    public Guid Id { get; private set; }

    public Guid ProductId { get; private set; }

    public Guid SizeId { get; private set; }

    public Guid ColorId { get; private set; }

    public string Barcode { get; private set; } = string.Empty;

    public decimal? PriceOverride { get; private set; }

    public decimal? Cost { get; private set; }

    public bool IsActive { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public long Version { get; private set; }

    public StockBalance? Balance { get; private set; }

    public void Update(string barcode, decimal? priceOverride, decimal? cost, bool isActive)
    {
        Barcode = barcode;
        PriceOverride = priceOverride;
        Cost = cost;
        IsActive = isActive;
    }
}

/// <summary>Existencia actual de una variante en la única ubicación (Tienda Managua).</summary>
public sealed class StockBalance
{
    private StockBalance()
    {
    }

    public StockBalance(Guid variantId, int quantity)
    {
        VariantId = variantId;
        Quantity = quantity;
    }

    public Guid VariantId { get; private set; }

    public int Quantity { get; set; }
}

public enum MovementType
{
    InitialStock,
    Entry,
    Adjustment,
    Loss,
    Sale,
    SaleVoid,

    /// <summary>Entra la prenda que el cliente devuelve en un cambio de talla.</summary>
    ExchangeIn,

    /// <summary>Sale la prenda que el cliente se lleva en un cambio de talla.</summary>
    ExchangeOut,
}

/// <summary>Movimiento inmutable del Kardex. Las correcciones se hacen con otro movimiento.</summary>
public sealed class InventoryMovement
{
    private InventoryMovement()
    {
    }

    public InventoryMovement(
        Guid id,
        Guid variantId,
        MovementType type,
        int quantity,
        int balanceAfter,
        string? reason,
        Guid? saleId,
        Guid? userId,
        DateTimeOffset createdAtUtc)
    {
        Id = id;
        VariantId = variantId;
        Type = type;
        Quantity = quantity;
        BalanceAfter = balanceAfter;
        Reason = reason;
        SaleId = saleId;
        UserId = userId;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid VariantId { get; private set; }

    public MovementType Type { get; private set; }

    public int Quantity { get; private set; }

    public int BalanceAfter { get; private set; }

    public string? Reason { get; private set; }

    public Guid? SaleId { get; private set; }

    public Guid? UserId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
