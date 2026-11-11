using LaGanga.Application.Common;
using LaGanga.Domain.Sales;

namespace LaGanga.Application.Sales;

/// <summary>Talla o color disponible para entregar a cambio (del mismo producto).</summary>
public sealed record ExchangeOptionDto(
    Guid VariantId,
    string SizeName,
    string ColorName,
    string? ColorHex,
    string Barcode,
    int Stock,
    decimal Price,
    bool IsActive);

public sealed record ExchangeableLineDto(
    Guid SaleLineId,
    Guid VariantId,
    Guid ProductId,
    string ProductName,
    string SizeName,
    string ColorName,
    string Barcode,
    int Quantity,
    int AlreadyExchanged,
    int Available,
    decimal UnitPrice,
    IReadOnlyList<ExchangeOptionDto> Options);

public sealed record ExchangeLineDto(
    string ProductName,
    int Quantity,
    decimal UnitPrice,
    string ReturnedSizeName,
    string ReturnedColorName,
    string ReturnedBarcode,
    string NewSizeName,
    string NewColorName,
    string NewBarcode);

public sealed record ExchangeDto(
    Guid Id,
    string Number,
    Guid SaleId,
    string SaleNumber,
    DateTimeOffset CreatedAtUtc,
    string UserName,
    string? RegisterName,
    string? Note,
    IReadOnlyList<ExchangeLineDto> Lines);

/// <summary>Lo que se necesita para decidir un cambio: la venta, el plazo y qué se puede cambiar.</summary>
public sealed record ExchangeLookupDto(
    Guid SaleId,
    string SaleNumber,
    DateTimeOffset SaleCreatedAtUtc,
    SaleStatus Status,
    decimal TotalNio,
    int DaysSinceSale,
    int WindowDays,
    bool CanExchange,
    string? BlockedReason,
    IReadOnlyList<ExchangeableLineDto> Lines,
    IReadOnlyList<ExchangeDto> Exchanges);

public sealed record ExchangeItemRequest(Guid SaleLineId, int Quantity, Guid NewVariantId);

public sealed record ExchangeRequest(
    Guid ClientExchangeId,
    Guid SaleId,
    Guid? CashSessionId,
    IReadOnlyList<ExchangeItemRequest>? Items,
    string? Note,
    string? ApproverUsername = null,
    string? ApproverPassword = null);

public sealed record ExchangeResultDto(bool AlreadyProcessed, ExchangeDto Exchange);

public interface IExchangeService
{
    Task<ServiceResult<ExchangeLookupDto>> LookupAsync(string? saleNumber, CancellationToken cancellationToken);

    Task<ServiceResult<ExchangeResultDto>> RegisterAsync(ExchangeRequest request, Actor actor, CancellationToken cancellationToken);
}
