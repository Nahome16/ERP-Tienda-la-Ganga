using LaGanga.Application.Common;
using LaGanga.Application.Sales;
using LaGanga.Application.Settings;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Sales;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Sales;

public sealed class CashService(
    LaGangaDbContext dbContext,
    IAuditWriter audit,
    TimeProvider timeProvider) : ICashService
{
    private const string OpenRegisterIndex = "UX_cash_sessions_open_register";

    public async Task<IReadOnlyList<CashRegisterDto>> ListRegistersAsync(CancellationToken cancellationToken)
    {
        var registers = await dbContext.CashRegisters.AsNoTracking().Where(register => register.IsActive)
            .OrderBy(register => register.Name).ToListAsync(cancellationToken);
        var open = await dbContext.CashSessions.AsNoTracking().Where(session => session.ClosedAtUtc == null).ToListAsync(cancellationToken);
        var names = await UserNamesAsync(open.Select(session => session.OpenedByUserId), cancellationToken);
        return registers.Select(register =>
        {
            var session = open.FirstOrDefault(candidate => candidate.RegisterId == register.Id);
            return new CashRegisterDto(
                register.Id,
                register.Name,
                session is null ? null : new OpenSessionInfoDto(session.Id, session.OpenedAtUtc, names[session.OpenedByUserId]));
        }).ToArray();
    }

    public async Task<ServiceResult<CashSessionDto>> OpenAsync(
        OpenSessionRequest request,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        var floatNio = request.OpeningFloatNio ?? 0;
        var floatUsd = request.OpeningFloatUsd ?? 0;
        if (floatNio is < 0 or > 100_000_000 || floatUsd is < 0 or > 100_000_000)
        {
            return Result.Fail<CashSessionDto>(ServiceErrorKind.Validation, "validation_failed", "El fondo inicial no puede ser negativo.", "openingFloatNio");
        }

        var register = await dbContext.CashRegisters.SingleOrDefaultAsync(
            candidate => candidate.Id == request.RegisterId && candidate.IsActive, cancellationToken);
        if (register is null)
        {
            return Result.Fail<CashSessionDto>(ServiceErrorKind.Validation, "validation_failed", "Elegí una caja válida.", "registerId");
        }

        if (await dbContext.CashSessions.AnyAsync(session => session.OpenedByUserId == actor.UserId && session.ClosedAtUtc == null, cancellationToken))
        {
            return Result.Fail<CashSessionDto>(ServiceErrorKind.Conflict, "user_has_open_session", "Ya tenés una caja abierta. Cerrala antes de abrir otra.");
        }

        if (await dbContext.CashSessions.AnyAsync(session => session.RegisterId == register.Id && session.ClosedAtUtc == null, cancellationToken))
        {
            return Result.Fail<CashSessionDto>(ServiceErrorKind.Conflict, "register_in_use", $"{register.Name} ya está abierta por otra persona.");
        }

        var session = new CashSession(Guid.NewGuid(), register.Id, actor.UserId, timeProvider.GetUtcNow(), floatNio, floatUsd);
        dbContext.CashSessions.Add(session);
        audit.Add(actor.UserId, "cash.opened", "CashSession", session.Id.ToString(), $"{register.Name} abierta con fondo C$ {floatNio} y US$ {floatUsd}.");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation } pg)
        {
            return string.Equals(pg.ConstraintName, OpenRegisterIndex, StringComparison.Ordinal)
                ? Result.Fail<CashSessionDto>(ServiceErrorKind.Conflict, "register_in_use", $"{register.Name} ya está abierta por otra persona.")
                : Result.Fail<CashSessionDto>(ServiceErrorKind.Conflict, "user_has_open_session", "Ya tenés una caja abierta. Cerrala antes de abrir otra.");
        }

        return Result.Ok((await MapSessionsAsync([session], cancellationToken))[0]);
    }

    public async Task<ServiceResult<CashSessionDto>> GetCurrentAsync(Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var session = await dbContext.CashSessions.AsNoTracking().Include(candidate => candidate.Register)
            .SingleOrDefaultAsync(candidate => candidate.OpenedByUserId == actor.UserId && candidate.ClosedAtUtc == null, cancellationToken);
        return session is null
            ? Result.Fail<CashSessionDto>(ServiceErrorKind.NotFound, "no_open_session", "No tenés una caja abierta.")
            : Result.Ok((await MapSessionsAsync([session], cancellationToken))[0]);
    }

    public async Task<ServiceResult<CashSummaryDto>> GetSummaryAsync(Guid sessionId, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);

        var session = await dbContext.CashSessions.AsNoTracking().Include(candidate => candidate.Register)
            .SingleOrDefaultAsync(candidate => candidate.Id == sessionId, cancellationToken);
        if (session is null)
        {
            return Result.Fail<CashSummaryDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa caja.");
        }

        if (session.OpenedByUserId != actor.UserId && !actor.Has(PermissionNames.CashReportRead))
        {
            return Result.Fail<CashSummaryDto>(ServiceErrorKind.Forbidden, "forbidden", "No podés ver el resumen de una caja que no es tuya.");
        }

        return Result.Ok((await SummarizeAsync([session], cancellationToken))[0]);
    }

    public async Task<ServiceResult<CashSummaryDto>> CloseAsync(
        Guid sessionId,
        CloseSessionRequest request,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        var session = await dbContext.CashSessions.Include(candidate => candidate.Register)
            .SingleOrDefaultAsync(candidate => candidate.Id == sessionId, cancellationToken);
        if (session is null)
        {
            return Result.Fail<CashSummaryDto>(ServiceErrorKind.NotFound, "not_found", "No encontramos esa caja.");
        }

        if (session.OpenedByUserId != actor.UserId && !actor.Has(PermissionNames.CashReportRead))
        {
            return Result.Fail<CashSummaryDto>(ServiceErrorKind.Forbidden, "forbidden", "No podés cerrar una caja que no es tuya.");
        }

        if (!session.IsOpen)
        {
            return Result.Fail<CashSummaryDto>(ServiceErrorKind.Conflict, "already_closed", "Esta caja ya fue cerrada.");
        }

        if (request.CountedCashNio is null or < 0 || request.CountedCashUsd is null or < 0)
        {
            return Result.Fail<CashSummaryDto>(ServiceErrorKind.Validation, "validation_failed", "Indicá el efectivo contado en córdobas y en dólares (puede ser cero).", "countedCashNio");
        }

        if (request.Notes is { Length: > 500 })
        {
            return Result.Fail<CashSummaryDto>(ServiceErrorKind.Validation, "validation_failed", "Las notas admiten hasta 500 caracteres.", "notes");
        }

        var verified = new[] { request.CountedTransferNio, request.CountedTransferUsd, request.CountedCardNio, request.CountedCardUsd };
        if (verified.Any(amount => amount is < 0))
        {
            return Result.Fail<CashSummaryDto>(ServiceErrorKind.Validation, "validation_failed", "Los montos verificados no pueden ser negativos.", "countedTransferNio");
        }

        session.Close(
            actor.UserId,
            timeProvider.GetUtcNow(),
            request.CountedCashNio.Value,
            request.CountedCashUsd.Value,
            request.Notes,
            request.CountedTransferNio,
            request.CountedTransferUsd,
            request.CountedCardNio,
            request.CountedCardUsd);
        audit.Add(
            actor.UserId,
            "cash.closed",
            "CashSession",
            session.Id.ToString(),
            $"{session.Register.Name} cerrada: efectivo contado C$ {request.CountedCashNio} y US$ {request.CountedCashUsd}"
            + $"{(request.CountedTransferNio is null && request.CountedTransferUsd is null ? string.Empty : $", transferencias verificadas C$ {request.CountedTransferNio ?? 0} y US$ {request.CountedTransferUsd ?? 0}")}"
            + $"{(request.CountedCardNio is null && request.CountedCardUsd is null ? string.Empty : $", tarjeta según terminal C$ {request.CountedCardNio ?? 0} y US$ {request.CountedCardUsd ?? 0}")}.");
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Ok((await SummarizeAsync([session], cancellationToken))[0]);
    }

    public async Task<IReadOnlyList<CashSummaryDto>> ListSessionsAsync(
        DateOnly fromDate,
        DateOnly toDate,
        CancellationToken cancellationToken)
    {
        var start = BusinessTime.DayRangeUtc(fromDate).StartUtc;
        var end = BusinessTime.DayRangeUtc(toDate).EndUtc;
        var sessions = await dbContext.CashSessions.AsNoTracking().Include(session => session.Register)
            .Where(session => session.OpenedAtUtc >= start && session.OpenedAtUtc < end)
            .OrderByDescending(session => session.OpenedAtUtc).ToListAsync(cancellationToken);
        return await SummarizeAsync(sessions, cancellationToken);
    }

    public async Task<CashConsolidatedDto> GetConsolidatedAsync(DateOnly businessDate, CancellationToken cancellationToken)
    {
        var (start, end) = BusinessTime.DayRangeUtc(businessDate);
        var sessions = await dbContext.CashSessions.AsNoTracking().Include(session => session.Register)
            .Where(session => session.OpenedAtUtc >= start && session.OpenedAtUtc < end)
            .OrderBy(session => session.Register.Name).ThenBy(session => session.OpenedAtUtc).ToListAsync(cancellationToken);
        var summaries = await SummarizeAsync(sessions, cancellationToken);

        var sales = await LoadSalesAsync(sessions.Select(session => session.Id).ToArray(), cancellationToken);
        var open = summaries.Count(summary => summary.Session.ClosedAtUtc is null);
        return new CashConsolidatedDto(
            businessDate,
            summaries,
            ComputeTotals(sales),
            summaries.Sum(summary => summary.ExpectedCashNio),
            summaries.Sum(summary => summary.ExpectedCashUsd),
            open > 0 ? null : summaries.Sum(summary => summary.Session.CountedCashNio ?? 0),
            open > 0 ? null : summaries.Sum(summary => summary.Session.CountedCashUsd ?? 0),
            open,
            summaries.Sum(summary => summary.ExpectedTransferNio),
            summaries.Sum(summary => summary.ExpectedTransferUsd),
            VerifiedSum(summaries, summary => summary.Session.CountedTransferNio),
            VerifiedSum(summaries, summary => summary.Session.CountedTransferUsd),
            summaries.Sum(summary => summary.ExpectedCardNio),
            summaries.Sum(summary => summary.ExpectedCardUsd),
            VerifiedSum(summaries, summary => summary.Session.CountedCardNio),
            VerifiedSum(summaries, summary => summary.Session.CountedCardUsd));
    }

    /// <summary>Suma lo verificado; es null si alguna caja sigue abierta o no verificó ese monto.</summary>
    private static decimal? VerifiedSum(IReadOnlyList<CashSummaryDto> summaries, Func<CashSummaryDto, decimal?> selector)
    {
        if (summaries.Count == 0 || summaries.Any(summary => summary.Session.ClosedAtUtc is null || selector(summary) is null))
        {
            return null;
        }

        return summaries.Sum(summary => selector(summary)!.Value);
    }

    internal static CashTotalsDto ComputeTotals(IReadOnlyCollection<Sale> sales)
    {
        var confirmed = sales.Where(sale => sale.Status == SaleStatus.Confirmed).ToArray();
        var voided = sales.Where(sale => sale.Status == SaleStatus.Voided).ToArray();
        var payments = confirmed.SelectMany(sale => sale.Payments).ToArray();

        var cashNio = payments.Where(p => p is { Method: PaymentMethod.Cash, Currency: Currency.NIO }).Sum(p => p.Amount);
        var cashUsd = payments.Where(p => p is { Method: PaymentMethod.Cash, Currency: Currency.USD }).Sum(p => p.Amount);
        var cashUsdEquivalent = payments.Where(p => p is { Method: PaymentMethod.Cash, Currency: Currency.USD }).Sum(p => p.AmountNio);
        var change = confirmed.Sum(sale => sale.ChangeNio);

        decimal Tendered(PaymentMethod method, Currency currency) =>
            payments.Where(p => p.Method == method && p.Currency == currency).Sum(p => p.Amount);
        decimal Equivalent(PaymentMethod method, Currency currency) =>
            payments.Where(p => p.Method == method && p.Currency == currency).Sum(p => p.AmountNio);

        var banks = payments.Where(p => p.Method == PaymentMethod.Transfer)
            .GroupBy(p => string.IsNullOrWhiteSpace(p.Bank) ? "Sin banco" : p.Bank!, StringComparer.OrdinalIgnoreCase)
            .Select(group => new BankTotalDto(
                group.Key,
                group.Sum(p => p.AmountNio),
                group.Where(p => p.Currency == Currency.USD).Sum(p => p.Amount)))
            .OrderByDescending(bank => bank.TotalNio).ToArray();
        var channels = confirmed.GroupBy(sale => sale.Channel)
            .Select(group => new ChannelTotalDto(group.Key, group.Count(), group.Sum(sale => sale.TotalNio)))
            .OrderBy(channel => channel.Channel).ToArray();

        return new CashTotalsDto(
            confirmed.Length,
            voided.Length,
            voided.Sum(sale => sale.TotalNio),
            confirmed.Count(sale => sale.RequiresReview),
            confirmed.Sum(sale => sale.SubtotalNio),
            confirmed.Sum(sale => sale.DiscountNio),
            confirmed.Sum(sale => sale.TotalNio),
            cashNio,
            cashUsd,
            cashUsdEquivalent,
            change,
            cashNio + cashUsdEquivalent - change,
            payments.Where(p => p.Method == PaymentMethod.Transfer).Sum(p => p.AmountNio),
            payments.Where(p => p.Method == PaymentMethod.Card).Sum(p => p.AmountNio),
            Tendered(PaymentMethod.Transfer, Currency.NIO),
            Tendered(PaymentMethod.Transfer, Currency.USD),
            Equivalent(PaymentMethod.Transfer, Currency.USD),
            Tendered(PaymentMethod.Card, Currency.NIO),
            Tendered(PaymentMethod.Card, Currency.USD),
            Equivalent(PaymentMethod.Card, Currency.USD),
            banks,
            channels);
    }

    private async Task<IReadOnlyList<Sale>> LoadSalesAsync(Guid[] sessionIds, CancellationToken cancellationToken) =>
        await dbContext.Sales.AsNoTracking().Include(sale => sale.Payments)
            .Where(sale => sessionIds.Contains(sale.CashSessionId)).ToListAsync(cancellationToken);

    private async Task<IReadOnlyList<CashSummaryDto>> SummarizeAsync(
        IReadOnlyList<CashSession> sessions,
        CancellationToken cancellationToken)
    {
        var dtos = await MapSessionsAsync(sessions, cancellationToken);
        var sales = await LoadSalesAsync(sessions.Select(session => session.Id).ToArray(), cancellationToken);
        var bySession = sales.ToLookup(sale => sale.CashSessionId);
        return sessions.Select((session, index) =>
        {
            var totals = ComputeTotals(bySession[session.Id].ToArray());
            var expectedNio = session.OpeningFloatNio + totals.CashNioTendered - totals.ChangeGivenNio;
            var expectedUsd = session.OpeningFloatUsd + totals.CashUsdTendered;
            return new CashSummaryDto(
                dtos[index],
                totals,
                expectedNio,
                expectedUsd,
                session.CountedCashNio is { } countedNio ? countedNio - expectedNio : null,
                session.CountedCashUsd is { } countedUsd ? countedUsd - expectedUsd : null,
                totals.TransferNioTendered,
                totals.TransferUsdTendered,
                session.CountedTransferNio is { } transferNio ? transferNio - totals.TransferNioTendered : null,
                session.CountedTransferUsd is { } transferUsd ? transferUsd - totals.TransferUsdTendered : null,
                totals.CardNioTendered,
                totals.CardUsdTendered,
                session.CountedCardNio is { } cardNio ? cardNio - totals.CardNioTendered : null,
                session.CountedCardUsd is { } cardUsd ? cardUsd - totals.CardUsdTendered : null);
        }).ToArray();
    }

    private async Task<IReadOnlyList<CashSessionDto>> MapSessionsAsync(
        IReadOnlyList<CashSession> sessions,
        CancellationToken cancellationToken)
    {
        var registerNames = await dbContext.CashRegisters.AsNoTracking().ToDictionaryAsync(register => register.Id, register => register.Name, cancellationToken);
        var ids = sessions.Select(session => session.OpenedByUserId)
            .Concat(sessions.Where(session => session.ClosedByUserId is not null).Select(session => session.ClosedByUserId!.Value));
        var names = await UserNamesAsync(ids, cancellationToken);
        return sessions.Select(session => new CashSessionDto(
            session.Id,
            session.RegisterId,
            registerNames[session.RegisterId],
            session.OpenedAtUtc,
            session.OpenedByUserId,
            names[session.OpenedByUserId],
            session.OpeningFloatNio,
            session.OpeningFloatUsd,
            session.ClosedAtUtc,
            session.ClosedByUserId is { } closedBy ? names[closedBy] : null,
            session.CountedCashNio,
            session.CountedCashUsd,
            session.ClosingNotes,
            session.CountedTransferNio,
            session.CountedTransferUsd,
            session.CountedCardNio,
            session.CountedCardUsd)).ToArray();
    }

    private async Task<Dictionary<Guid, string>> UserNamesAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken)
    {
        var distinct = ids.Distinct().ToArray();
        return await dbContext.Users.AsNoTracking().Where(user => distinct.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
    }
}
