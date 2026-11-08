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
    long Version);

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
    IReadOnlyList<VariantDto> Variants);

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
    int InitialQuantity);

public sealed record CreateProductInput(
    string? Name,
    Guid CategoryId,
    Guid BrandId,
    Guid? CutId,
    decimal? BasePrice,
    IReadOnlyList<NewVariantInput>? Variants);

public sealed record UpdateProductInput(
    string? Name,
    Guid CategoryId,
    Guid BrandId,
    Guid? CutId,
    decimal? BasePrice,
    bool? IsActive);

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
    int? Quantity);

public sealed record ImportRequest(bool DryRun, bool CreateMissingCatalogs, IReadOnlyList<ImportRowInput>? Rows);

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
    decimal? StockValue);

public sealed record InventoryQuery(string? Search, string? Filter, int Page, int PageSize);

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

public sealed record AdjustmentInput(Guid VariantId, AdjustmentKind Kind, int Delta, string? Reason);

public sealed record AdjustmentResultDto(Guid VariantId, int Delta, int NewStock);

public interface IInventoryService
{
    Task<InventorySummaryDto> GetSummaryAsync(CancellationToken cancellationToken);

    Task<PageResult<InventoryRowDto>> ListAsync(InventoryQuery query, Actor actor, CancellationToken cancellationToken);

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
