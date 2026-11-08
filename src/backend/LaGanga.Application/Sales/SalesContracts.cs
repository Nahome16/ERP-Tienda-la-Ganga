using LaGanga.Application.Common;
using LaGanga.Application.Settings;
using LaGanga.Domain.Sales;

namespace LaGanga.Application.Sales;

// ---- POS ----

public sealed record PosVariantDto(
    Guid VariantId,
    Guid ProductId,
    string ProductName,
    string CategoryName,
    string BrandName,
    string SizeName,
    string ColorName,
    string? ColorHex,
    string Barcode,
    decimal Price,
    int Stock,
    string? ImageUrl);

public sealed record PosSnapshotDto(
    DateTimeOffset GeneratedAtUtc,
    StoreSettingsDto Settings,
    IReadOnlyList<PosVariantDto> Variants);

public sealed record DiscountApprovalRequest(string? Username, string? Password);

public sealed record DiscountApprovalDto(Guid ApprovalId, string ApproverName, DateTimeOffset ExpiresAtUtc);

public interface IPosService
{
    Task<PosSnapshotDto> GetSnapshotAsync(CancellationToken cancellationToken);

    Task<ServiceResult<DiscountApprovalDto>> CreateDiscountApprovalAsync(
        DiscountApprovalRequest request,
        Actor actor,
        CancellationToken cancellationToken);
}

// ---- Cajas ----

public sealed record OpenSessionInfoDto(Guid Id, DateTimeOffset OpenedAtUtc, string OpenedByName);

public sealed record CashRegisterDto(Guid Id, string Name, OpenSessionInfoDto? OpenSession);

public sealed record OpenSessionRequest(Guid RegisterId, decimal? OpeningFloatNio, decimal? OpeningFloatUsd);

public sealed record CloseSessionRequest(decimal? CountedCashNio, decimal? CountedCashUsd, string? Notes);

public sealed record CashSessionDto(
    Guid Id,
    Guid RegisterId,
    string RegisterName,
    DateTimeOffset OpenedAtUtc,
    Guid OpenedByUserId,
    string OpenedByName,
    decimal OpeningFloatNio,
    decimal OpeningFloatUsd,
    DateTimeOffset? ClosedAtUtc,
    string? ClosedByName,
    decimal? CountedCashNio,
    decimal? CountedCashUsd,
    string? ClosingNotes);

public sealed record BankTotalDto(string Bank, decimal TotalNio);

public sealed record ChannelTotalDto(SaleChannel Channel, int SalesCount, decimal TotalNio);

public sealed record CashTotalsDto(
    int SalesCount,
    int VoidedCount,
    decimal VoidedTotalNio,
    int ReviewCount,
    decimal GrossTotalNio,
    decimal DiscountTotalNio,
    decimal NetTotalNio,
    decimal CashNioTendered,
    decimal CashUsdTendered,
    decimal CashUsdEquivalentNio,
    decimal ChangeGivenNio,
    decimal CashTotalNio,
    decimal TransferTotalNio,
    decimal CardTotalNio,
    IReadOnlyList<BankTotalDto> TransfersByBank,
    IReadOnlyList<ChannelTotalDto> ByChannel);

public sealed record CashSummaryDto(
    CashSessionDto Session,
    CashTotalsDto Totals,
    decimal ExpectedCashNio,
    decimal ExpectedCashUsd,
    decimal? DifferenceCashNio,
    decimal? DifferenceCashUsd);

public sealed record CashConsolidatedDto(
    DateOnly Date,
    IReadOnlyList<CashSummaryDto> Sessions,
    CashTotalsDto Totals,
    decimal ExpectedCashNio,
    decimal ExpectedCashUsd,
    decimal? CountedCashNio,
    decimal? CountedCashUsd,
    int OpenSessionsCount);

public interface ICashService
{
    Task<IReadOnlyList<CashRegisterDto>> ListRegistersAsync(CancellationToken cancellationToken);

    Task<ServiceResult<CashSessionDto>> OpenAsync(OpenSessionRequest request, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<CashSessionDto>> GetCurrentAsync(Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<CashSummaryDto>> GetSummaryAsync(Guid sessionId, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<CashSummaryDto>> CloseAsync(
        Guid sessionId,
        CloseSessionRequest request,
        Actor actor,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<CashSummaryDto>> ListSessionsAsync(
        DateOnly fromDate,
        DateOnly toDate,
        CancellationToken cancellationToken);

    Task<CashConsolidatedDto> GetConsolidatedAsync(DateOnly businessDate, CancellationToken cancellationToken);
}

// ---- Ventas ----

public sealed record SaleLineRequest(Guid VariantId, int Quantity, decimal UnitPrice);

public sealed record DiscountRequest(DiscountType Type, decimal Value);

public sealed record PaymentRequest(
    PaymentMethod Method,
    Currency Currency,
    decimal Amount,
    decimal? ExchangeRate,
    string? Bank,
    string? Reference);

public sealed record SaleRequest(
    Guid ClientSaleId,
    Guid CashSessionId,
    SaleChannel Channel,
    DateTimeOffset CreatedAtUtc,
    bool IsOffline,
    IReadOnlyList<SaleLineRequest>? Lines,
    DiscountRequest? Discount,
    Guid? DiscountApprovalId,
    IReadOnlyList<PaymentRequest>? Payments,
    string? Note);

public sealed record SaleLineDto(
    Guid VariantId,
    string ProductName,
    string SizeName,
    string ColorName,
    string Barcode,
    int Quantity,
    decimal UnitPrice,
    decimal LineTotalNio);

public sealed record SalePaymentDto(
    PaymentMethod Method,
    Currency Currency,
    decimal Amount,
    decimal? ExchangeRate,
    decimal AmountNio,
    string? Bank,
    string? Reference);

public sealed record SaleDto(
    Guid Id,
    string Number,
    Guid ClientSaleId,
    SaleStatus Status,
    SaleChannel Channel,
    Guid CashSessionId,
    string RegisterName,
    string SellerName,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ReceivedAtUtc,
    bool IsOffline,
    decimal SubtotalNio,
    DiscountType? DiscountType,
    decimal? DiscountValue,
    decimal DiscountNio,
    decimal TotalNio,
    decimal ChangeNio,
    bool RequiresReview,
    string? ReviewNote,
    string? Note,
    DateTimeOffset? VoidedAtUtc,
    string? VoidedByName,
    string? VoidReason,
    IReadOnlyList<SaleLineDto> Lines,
    IReadOnlyList<SalePaymentDto> Payments);

public sealed record SaleResultDto(bool AlreadyProcessed, SaleDto Sale);

public sealed record SaleListQuery(
    DateOnly? From,
    DateOnly? To,
    Guid? SessionId,
    string? Status,
    bool? NeedsReview,
    string? Number,
    int Page,
    int PageSize);

public sealed record VoidSaleRequest(string? Reason);

public sealed record ResolveReviewRequest(string? Note);

public interface ISalesService
{
    Task<ServiceResult<SaleResultDto>> RegisterAsync(SaleRequest request, Actor actor, CancellationToken cancellationToken);

    Task<PageResult<SaleDto>> ListAsync(SaleListQuery query, CancellationToken cancellationToken);

    Task<ServiceResult<IReadOnlyList<SaleDto>>> ListBySessionAsync(
        Guid sessionId,
        Actor actor,
        CancellationToken cancellationToken);

    Task<ServiceResult<SaleDto>> GetAsync(Guid id, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<SaleDto>> VoidAsync(Guid id, VoidSaleRequest request, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<SaleDto>> ResolveReviewAsync(
        Guid id,
        ResolveReviewRequest request,
        Actor actor,
        CancellationToken cancellationToken);
}
