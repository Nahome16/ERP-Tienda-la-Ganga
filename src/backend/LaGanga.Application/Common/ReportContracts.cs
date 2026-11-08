namespace LaGanga.Application.Common;

public sealed record ReportFile(string FileName, byte[] Content);

public interface IReportService
{
    Task<ServiceResult<ReportFile>> SalesAsync(DateOnly fromDate, DateOnly toDate, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<ReportFile>> InventoryAsync(Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<ReportFile>> MovementsAsync(DateOnly fromDate, DateOnly toDate, Actor actor, CancellationToken cancellationToken);

    Task<ServiceResult<ReportFile>> CashAsync(DateOnly fromDate, DateOnly toDate, Actor actor, CancellationToken cancellationToken);
}
