using LaGanga.Application.Common;

namespace LaGanga.Application.Investment;

public sealed record PartnerDto(Guid Id, string Name, string? Phone, string? Notes, bool IsActive, long Version);

public sealed record PartnerInput(string? Name, string? Phone, string? Notes, bool? IsActive);

/// <summary>Una fila por socio (y «Sin socio»). Dinero en córdobas.</summary>
public sealed record PartnerSummaryDto(
    Guid? PartnerId,
    string PartnerName,
    int UnitsEntered,
    decimal InvestedNio,
    int UnitsWithoutCost,
    int UnitsInStock,
    decimal StockAtCostNio,
    decimal StockAtPriceNio,
    int UnitsSold,
    decimal RevenueNio,
    decimal CostOfSoldNio,
    decimal ProfitNio,
    int SoldUnitsWithoutCost,
    int LossUnits,
    decimal LossCostNio);

public sealed record InvestmentSummaryDto(
    DateOnly? From,
    DateOnly? To,
    IReadOnlyList<PartnerSummaryDto> Partners,
    PartnerSummaryDto Totals);

public sealed record ProductBreakdownDto(
    Guid? PartnerId,
    string PartnerName,
    Guid ProductId,
    string ProductName,
    int UnitsEntered,
    decimal InvestedNio,
    int UnitsInStock,
    decimal StockAtCostNio,
    int UnitsSold,
    decimal RevenueNio,
    decimal ProfitNio);

public sealed record LotDto(
    Guid Id,
    Guid? PartnerId,
    string PartnerName,
    Guid VariantId,
    Guid ProductId,
    string ProductName,
    string SizeName,
    string ColorName,
    string Barcode,
    DateTimeOffset EnteredAtUtc,
    string EnteredByName,
    string Source,
    string? Note,
    int QuantityIn,
    int QuantityRemaining,
    int QuantitySold,
    int QuantityLost,
    decimal? UnitCost,
    decimal? UnitPrice,
    decimal CurrentPrice,
    decimal InvestedNio,
    decimal StockAtCostNio);

public sealed record LotQuery(
    string? PartnerId,
    string? Search,
    bool OnlyWithStock,
    DateOnly? From,
    DateOnly? To,
    int Page,
    int PageSize,
    Guid? LotId = null);

public sealed record UpdateLotInput(Guid? PartnerId, decimal? UnitCost, decimal? UnitPrice, string? Note);

public interface IInvestmentService
{
    Task<IReadOnlyList<PartnerDto>> ListPartnersAsync(string? status, CancellationToken cancellationToken);

    Task<ServiceResult<PartnerDto>> CreatePartnerAsync(PartnerInput input, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<PartnerDto>> UpdatePartnerAsync(Guid id, PartnerInput input, Actor actor, CancellationToken cancellationToken);

    Task<InvestmentSummaryDto> GetSummaryAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken cancellationToken);

    Task<IReadOnlyList<ProductBreakdownDto>> GetBreakdownAsync(string? partnerId, DateOnly? fromDate, DateOnly? toDate, CancellationToken cancellationToken);

    Task<PageResult<LotDto>> ListLotsAsync(LotQuery query, CancellationToken cancellationToken);

    Task<ServiceResult<LotDto>> UpdateLotAsync(Guid id, UpdateLotInput input, Actor actor, CancellationToken cancellationToken);
}
