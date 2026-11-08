namespace LaGanga.Application.Catalog;

public enum CatalogKind
{
    Categories,
    Brands,
    Cuts,
    SizeGroups,
    Sizes,
    Colors,
}

public enum CatalogStatusFilter
{
    Active,
    Inactive,
    All,
}

/// <summary>
/// Representación común de un elemento de catálogo. Los campos
/// <see cref="ParentId"/>, <see cref="SizeGroupId"/> y <see cref="SwatchHex"/>
/// solo aplican a categorías, tallas y colores respectivamente.
/// </summary>
public sealed record CatalogItemDto(
    Guid Id,
    string Name,
    bool IsActive,
    int SortOrder,
    long Version,
    Guid? ParentId,
    Guid? SizeGroupId,
    string? SwatchHex,
    DateTimeOffset UpdatedAtUtc);

public sealed record CatalogItemInput(
    string? Name,
    int? SortOrder,
    bool? IsActive,
    Guid? ParentId,
    Guid? SizeGroupId,
    string? SwatchHex);

public sealed record CatalogListQuery(
    CatalogStatusFilter Status,
    string? Search,
    int Page,
    int PageSize,
    Guid? ParentId,
    Guid? SizeGroupId)
{
    public const int DefaultPageSize = 25;

    public const int MaxPageSize = 100;
}

public sealed record PagedResult<T>(
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages,
    string Sort);

public enum CatalogErrorKind
{
    Validation,
    NotFound,
    Conflict,
    BusinessRule,
}

public sealed record CatalogError(
    CatalogErrorKind Kind,
    string Code,
    string Message,
    string? Field = null);

public sealed class CatalogResult<T>
{
    internal CatalogResult(T? value, CatalogError? error)
    {
        Value = value;
        Error = error;
    }

    public T? Value { get; }

    public CatalogError? Error { get; }

    public bool Succeeded => Error is null;
}

public static class CatalogResult
{
    public static CatalogResult<T> Success<T>(T value) => new(value, null);

    public static CatalogResult<T> Failure<T>(CatalogError error) => new(default, error);
}

public interface ICatalogService
{
    Task<PagedResult<CatalogItemDto>> ListAsync(
        CatalogKind kind,
        CatalogListQuery query,
        CancellationToken cancellationToken);

    Task<CatalogResult<CatalogItemDto>> GetAsync(
        CatalogKind kind,
        Guid id,
        CancellationToken cancellationToken);

    Task<CatalogResult<CatalogItemDto>> CreateAsync(
        CatalogKind kind,
        CatalogItemInput input,
        Guid userId,
        CancellationToken cancellationToken);

    Task<CatalogResult<CatalogItemDto>> UpdateAsync(
        CatalogKind kind,
        Guid id,
        long expectedVersion,
        CatalogItemInput input,
        Guid userId,
        CancellationToken cancellationToken);

    Task<CatalogResult<CatalogItemDto>> SetActiveAsync(
        CatalogKind kind,
        Guid id,
        long expectedVersion,
        bool isActive,
        Guid userId,
        CancellationToken cancellationToken);
}
