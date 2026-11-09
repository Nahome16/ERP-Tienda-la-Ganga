using LaGanga.Application.Common;

namespace LaGanga.Application.Settings;

public sealed record StoreSettingsDto(
    decimal UsdRate,
    string StoreName,
    string StoreAddress,
    string StorePhone,
    string OwnerName,
    string TaxId,
    string ReceiptLegend,
    string ReceiptFooter,
    IReadOnlyList<string> Banks,
    decimal SellerDiscountLimitPercent,
    int LowStockThreshold);

public sealed record UpdateSettingsInput(
    decimal? UsdRate,
    string? StoreName,
    string? StoreAddress,
    string? StorePhone,
    string? OwnerName,
    string? TaxId,
    string? ReceiptLegend,
    string? ReceiptFooter,
    IReadOnlyList<string>? Banks,
    decimal? SellerDiscountLimitPercent,
    int? LowStockThreshold);

public interface ISettingsService
{
    Task<StoreSettingsDto> GetAsync(CancellationToken cancellationToken);

    Task<ServiceResult<StoreSettingsDto>> UpdateAsync(
        UpdateSettingsInput input,
        Guid userId,
        CancellationToken cancellationToken);
}

public sealed record AuditEventDto(
    Guid Id,
    DateTimeOffset OccurredAtUtc,
    string UserName,
    string Action,
    string EntityType,
    string EntityId,
    string Summary);

public sealed record AuditQuery(
    string? EntityType,
    Guid? UserId,
    DateOnly? From,
    DateOnly? To,
    int Page,
    int PageSize);

/// <summary>Agrega un evento de auditoría al mismo guardado que la operación (misma transacción).</summary>
public interface IAuditWriter
{
    void Add(Guid? userId, string action, string entityType, string entityId, string summary);
}

public interface IAuditQueryService
{
    Task<PageResult<AuditEventDto>> ListAsync(AuditQuery query, CancellationToken cancellationToken);
}
