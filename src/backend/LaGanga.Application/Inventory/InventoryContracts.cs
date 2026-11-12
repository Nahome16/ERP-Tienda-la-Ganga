using LaGanga.Application.Common;
using LaGanga.Domain.Inventory;

namespace LaGanga.Application.Inventory;

public sealed record ProductListItemDto(
    Guid Id,
    string Name,
    Guid CategoryId,
    string CategoryName,
    Guid BrandId,
    string BrandName,
    Guid? CutId,
    string? CutName,
    decimal BasePrice,
    bool IsActive,
    int VariantCount,
    int TotalStock,
    long Version,
    string? PrimaryImageUrl,
    string? Barcode = null,
    // Alguna talla no tiene precio de venta (precio pendiente): no se puede vender.
    bool MissingPrice = false,
    string? ReferenceCode = null);

public sealed record VariantDto(
    Guid Id,
    Guid ProductId,
    Guid SizeId,
    string SizeName,
    Guid ColorId,
    string ColorName,
    string? ColorHex,
    string Barcode,
    decimal? PriceOverride,
    decimal Price,
    int Stock,
    bool IsActive,
    long Version,
    decimal? Cost);

public sealed record ProductDetailDto(
    Guid Id,
    string Name,
    Guid CategoryId,
    string CategoryName,
    Guid BrandId,
    string BrandName,
    Guid? CutId,
    string? CutName,
    decimal BasePrice,
    bool IsActive,
    int VariantCount,
    int TotalStock,
    long Version,
    string? PrimaryImageUrl,
    IReadOnlyList<VariantDto> Variants,
    IReadOnlyList<ProductImageDto> Images,
    string? Barcode = null,
    IReadOnlyList<ColorBarcodeDto>? ColorBarcodes = null,
    string? ReferenceCode = null);

/// <summary>Lo vendido de una variante (ventas confirmadas): unidades, ingresos y costo (si se puede ver).</summary>
public sealed record VariantSalesDto(Guid VariantId, int SoldUnits, decimal SoldRevenueNio, decimal? SoldCostNio);

/// <summary>Código de fábrica de un color: lo comparten todas las tallas de ese color.</summary>
public sealed record ColorBarcodeDto(Guid ColorId, string ColorName, string Barcode);

public sealed record ColorBarcodeInput(Guid ColorId, string? Barcode);

public sealed record SetColorBarcodeInput(string? Barcode);

/// <summary>Producto encontrado por un código de fábrica; <c>ColorId</c> si el código es de un color.</summary>
public sealed record ProductBarcodeMatchDto(ProductDetailDto Product, Guid? ColorId);

public sealed record VariantLookupDto(string ProductName, VariantDto Variant);

public sealed record ProductListQuery(
    string? Search,
    Guid? CategoryId,
    Guid? BrandId,
    string? Status,
    int Page,
    int PageSize);

public sealed record NewVariantInput(
    Guid SizeId,
    Guid ColorId,
    string? Barcode,
    decimal? PriceOverride,
    decimal? Cost,
    int InitialQuantity,
    Guid? PartnerId = null);

public sealed record CreateProductInput(
    string? Name,
    Guid CategoryId,
    Guid BrandId,
    Guid? CutId,
    decimal? BasePrice,
    IReadOnlyList<NewVariantInput>? Variants,
    DateOnly? ReceivedOn = null,
    string? Barcode = null,
    IReadOnlyList<ColorBarcodeInput>? ColorBarcodes = null,
    string? ReferenceCode = null,
    bool GenerateProductBarcode = false);

public sealed record UpdateProductInput(
    string? Name,
    Guid CategoryId,
    Guid BrandId,
    Guid? CutId,
    decimal? BasePrice,
    bool? IsActive,
    string? Barcode = null,
    string? ReferenceCode = null);

public sealed record UpdateVariantInput(string? Barcode, decimal? PriceOverride, decimal? Cost, bool? IsActive);

public sealed record ImportRowInput(
    string? ProductName,
    string? Category,
    string? Brand,
    string? Cut,
    string? Size,
    string? Color,
    string? Barcode,
    decimal? Price,
    decimal? Cost,
    int? Quantity,
    string? Partner = null);

public sealed record ImportRequest(bool DryRun, bool CreateMissingCatalogs, IReadOnlyList<ImportRowInput>? Rows, bool CreateMissingPartners = false);

public sealed record ImportError(int Row, string Message);

public sealed record ImportResult(
    bool DryRun,
    int ProductsCreated,
    int VariantsCreated,
    int UnitsLoaded,
    IReadOnlyList<string> CatalogsCreated,
    IReadOnlyList<ImportError> Errors);

public interface IProductService
{
    Task<PageResult<ProductListItemDto>> ListAsync(ProductListQuery query, CancellationToken cancellationToken);

    Task<ServiceResult<ProductDetailDto>> GetAsync(Guid id, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<ProductDetailDto>> CreateAsync(
        CreateProductInput input,
        Actor actor,
        CancellationToken cancellationToken);

    Task<ServiceResult<ProductDetailDto>> UpdateAsync(
        Guid id,
        long expectedVersion,
        UpdateProductInput input,
        Actor actor,
        CancellationToken cancellationToken);

    Task<ServiceResult<ProductDetailDto>> AddVariantAsync(
        Guid productId,
        NewVariantInput input,
        Actor actor,
        CancellationToken cancellationToken);

    Task<ServiceResult<VariantDto>> UpdateVariantAsync(
        Guid variantId,
        long expectedVersion,
        UpdateVariantInput input,
        Actor actor,
        CancellationToken cancellationToken);

    Task<ServiceResult<VariantLookupDto>> FindByBarcodeAsync(
        string barcode,
        Actor actor,
        CancellationToken cancellationToken);

    /// <summary>Lo vendido de cada variante del producto, para el balance de la ficha.</summary>
    Task<ServiceResult<IReadOnlyList<VariantSalesDto>>> GetSalesSummaryAsync(Guid id, Actor actor, CancellationToken cancellationToken);

    /// <summary>Elimina un producto sin ventas, con todo lo suyo. Con ventas: conflicto «product_has_sales».</summary>
    Task<ServiceResult<bool>> DeleteAsync(Guid id, Actor actor, CancellationToken cancellationToken);

    /// <summary>Pone, cambia o quita (vacío) el código de fábrica de un color del producto.</summary>
    Task<ServiceResult<ProductDetailDto>> SetColorBarcodeAsync(
        Guid productId,
        Guid colorId,
        SetColorBarcodeInput input,
        Actor actor,
        CancellationToken cancellationToken);

    /// <summary>Producto por su código de fábrica: el del producto (todas las tallas) o el de un color.</summary>
    Task<ServiceResult<ProductBarcodeMatchDto>> FindProductByBarcodeAsync(
        string barcode,
        Actor actor,
        CancellationToken cancellationToken);

    Task<ServiceResult<ImportResult>> ImportAsync(
        ImportRequest request,
        Actor actor,
        CancellationToken cancellationToken);
}

public sealed record InventorySummaryDto(
    int TotalUnits,
    int TotalVariants,
    int LowStockCount,
    int OutOfStockCount,
    int NegativeCount);

public sealed record InventoryRowDto(
    Guid VariantId,
    Guid ProductId,
    string ProductName,
    string CategoryName,
    string SizeName,
    string ColorName,
    string Barcode,
    decimal Price,
    int Stock,
    decimal? Cost,
    decimal? StockValue,
    int? PartnerStock = null,
    IReadOnlyList<PartnerUnitsDto>? Partners = null,
    string? ImageUrl = null,
    int SoldUnits = 0,
    string? ProductBarcode = null,
    string? ReferenceCode = null);

/// <summary>
/// Existencias agrupadas por producto madre: la suma de sus tallas y colores, el rango de precio
/// y de costo, el valor al costo y lo vendido (ventas confirmadas).
/// </summary>
public sealed record InventoryProductRowDto(
    Guid ProductId,
    string ProductName,
    string CategoryName,
    string BrandName,
    string? Barcode,
    string? ReferenceCode,
    string? ImageUrl,
    int Variants,
    int Stock,
    decimal MinPrice,
    decimal MaxPrice,
    decimal? MinCost,
    decimal? MaxCost,
    decimal? StockValue,
    int SoldUnits,
    decimal SoldRevenue,
    bool MissingPrice);

public sealed record PartnerUnitsDto(Guid? PartnerId, string Name, int Units);

public sealed record InventoryQuery(string? Search, string? Filter, int Page, int PageSize, string? PartnerId = null);

public sealed record KardexRowDto(
    MovementType Type,
    int Quantity,
    int BalanceAfter,
    string? Reason,
    string? SaleNumber,
    string UserName,
    DateTimeOffset CreatedAtUtc);

public enum AdjustmentKind
{
    Entry,
    Adjustment,
    Loss,
}

public sealed record AdjustmentInput(
    Guid VariantId,
    AdjustmentKind Kind,
    int Delta,
    string? Reason,
    Guid? PartnerId = null,
    decimal? UnitCost = null,
    decimal? UnitPrice = null);

public sealed record AdjustmentResultDto(Guid VariantId, int Delta, int NewStock);

public interface IInventoryService
{
    Task<InventorySummaryDto> GetSummaryAsync(CancellationToken cancellationToken);

    Task<PageResult<InventoryRowDto>> ListAsync(InventoryQuery query, Actor actor, CancellationToken cancellationToken);

    Task<PageResult<InventoryProductRowDto>> ListProductsAsync(InventoryQuery query, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<PageResult<KardexRowDto>>> GetKardexAsync(
        Guid variantId,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    Task<ServiceResult<AdjustmentResultDto>> AdjustAsync(
        AdjustmentInput input,
        Actor actor,
        CancellationToken cancellationToken);
}
