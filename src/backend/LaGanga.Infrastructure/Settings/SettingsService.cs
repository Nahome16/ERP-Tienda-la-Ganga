using LaGanga.Application.Common;
using LaGanga.Application.Settings;
using LaGanga.Domain.Settings;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Settings;

public sealed class AuditWriter(LaGangaDbContext dbContext, TimeProvider timeProvider) : IAuditWriter
{
    public void Add(Guid? userId, string action, string entityType, string entityId, string summary)
    {
        dbContext.AuditEvents.Add(new AuditEvent(
            Guid.NewGuid(),
            timeProvider.GetUtcNow(),
            userId,
            action,
            entityType,
            entityId,
            summary.Length > 1000 ? summary[..1000] : summary));
    }
}

public sealed class AuditQueryService(LaGangaDbContext dbContext) : IAuditQueryService
{
    public async Task<PageResult<AuditEventDto>> ListAsync(AuditQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var events = dbContext.AuditEvents.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(query.EntityType))
        {
            var entityType = query.EntityType.Trim();
            events = events.Where(auditEvent => auditEvent.EntityType == entityType);
        }

        if (query.UserId is { } userId)
        {
            events = events.Where(auditEvent => auditEvent.UserId == userId);
        }

        if (query.From is { } from)
        {
            var start = BusinessTime.DayRangeUtc(from).StartUtc;
            events = events.Where(auditEvent => auditEvent.OccurredAtUtc >= start);
        }

        if (query.To is { } to)
        {
            var end = BusinessTime.DayRangeUtc(to).EndUtc;
            events = events.Where(auditEvent => auditEvent.OccurredAtUtc < end);
        }

        var total = await events.CountAsync(cancellationToken);
        var rows = await (
            from auditEvent in events.OrderByDescending(e => e.OccurredAtUtc)
                .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            join user in dbContext.Users on auditEvent.UserId equals user.Id into users
            from user in users.DefaultIfEmpty()
            orderby auditEvent.OccurredAtUtc descending
            select new AuditEventDto(
                auditEvent.Id,
                auditEvent.OccurredAtUtc,
                user == null ? "Sistema" : user.DisplayName,
                auditEvent.Action,
                auditEvent.EntityType,
                auditEvent.EntityId,
                auditEvent.Summary))
            .ToListAsync(cancellationToken);
        return Paging.Create(rows, query.Page, query.PageSize, total);
    }
}

public sealed class SettingsService(
    LaGangaDbContext dbContext,
    IAuditWriter audit,
    TimeProvider timeProvider) : ISettingsService
{
    public async Task<StoreSettingsDto> GetAsync(CancellationToken cancellationToken)
    {
        var settings = await dbContext.Settings.AsNoTracking().SingleAsync(cancellationToken);
        return Map(settings);
    }

    public async Task<ServiceResult<StoreSettingsDto>> UpdateAsync(
        UpdateSettingsInput input,
        Guid userId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);

        var settings = await dbContext.Settings.SingleAsync(cancellationToken);

        if (input.UsdRate is { } rate)
        {
            if (rate is <= 0 or > 1000)
            {
                return Invalid("usdRate", "La tasa del dólar debe ser mayor que cero.");
            }

            settings.UsdRate = Math.Round(rate, 4, MidpointRounding.AwayFromZero);
        }

        if (input.StoreName is { } name)
        {
            if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 120)
            {
                return Invalid("storeName", "El nombre de la tienda es obligatorio (máximo 120 caracteres).");
            }

            settings.StoreName = name.Trim();
        }

        if (input.StoreAddress is { } address)
        {
            if (address.Trim().Length > 250)
            {
                return Invalid("storeAddress", "La dirección admite hasta 250 caracteres.");
            }

            settings.StoreAddress = address.Trim();
        }

        if (input.StorePhone is { } phone)
        {
            if (phone.Trim().Length > 50)
            {
                return Invalid("storePhone", "El teléfono admite hasta 50 caracteres.");
            }

            settings.StorePhone = phone.Trim();
        }

        if (input.OwnerName is { } owner)
        {
            if (owner.Trim().Length > 120)
            {
                return Invalid("ownerName", "El nombre del contribuyente admite hasta 120 caracteres.");
            }

            settings.OwnerName = owner.Trim();
        }

        if (input.TaxId is { } taxId)
        {
            var ruc = taxId.Trim().ToUpperInvariant();
            if (ruc.Length > 30 || !ruc.All(character => char.IsAsciiLetterOrDigit(character) || character == '-'))
            {
                return Invalid("taxId", "El RUC solo admite letras, números y guiones (hasta 30 caracteres).");
            }

            settings.TaxId = ruc;
        }

        if (input.ReceiptLegend is { } legend)
        {
            if (legend.Trim().Length > 120)
            {
                return Invalid("receiptLegend", "La leyenda del recibo admite hasta 120 caracteres.");
            }

            settings.ReceiptLegend = legend.Trim();
        }

        if (input.ReceiptFooter is { } footer)
        {
            if (footer.Trim().Length > 250)
            {
                return Invalid("receiptFooter", "El pie del recibo admite hasta 250 caracteres.");
            }

            settings.ReceiptFooter = footer.Trim();
        }

        if (input.Banks is { } banks)
        {
            var cleaned = banks
                .Select(bank => bank?.Trim() ?? string.Empty)
                .Where(bank => bank.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (cleaned.Length > 20 || cleaned.Any(bank => bank.Length > 100))
            {
                return Invalid("banks", "Se admiten hasta 20 bancos de máximo 100 caracteres.");
            }

            settings.Banks = cleaned;
        }

        if (input.SellerDiscountLimitPercent is { } limit)
        {
            if (limit is < 0 or > 100)
            {
                return Invalid("sellerDiscountLimitPercent", "El límite de descuento debe estar entre 0 y 100.");
            }

            settings.SellerDiscountLimitPercent = Math.Round(limit, 2);
        }

        if (input.LowStockThreshold is { } threshold)
        {
            if (threshold is < 0 or > 1000)
            {
                return Invalid("lowStockThreshold", "El umbral de stock bajo debe estar entre 0 y 1000.");
            }

            settings.LowStockThreshold = threshold;
        }

        settings.UpdatedAtUtc = timeProvider.GetUtcNow();
        settings.UpdatedBy = userId;
        audit.Add(
            userId,
            "settings.updated",
            "Settings",
            StoreSettings.SingletonId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            $"Configuración actualizada: tasa USD {settings.UsdRate}, límite de descuento {settings.SellerDiscountLimitPercent}%.");
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Ok(Map(settings));
    }

    internal static StoreSettingsDto Map(StoreSettings settings) =>
        new(
            settings.UsdRate,
            settings.StoreName,
            settings.StoreAddress,
            settings.StorePhone,
            settings.OwnerName,
            settings.TaxId,
            settings.ReceiptLegend,
            settings.ReceiptFooter,
            settings.Banks,
            settings.SellerDiscountLimitPercent,
            settings.LowStockThreshold);

    private static ServiceResult<StoreSettingsDto> Invalid(string field, string message) =>
        Result.Fail<StoreSettingsDto>(ServiceErrorKind.Validation, "validation_failed", message, field);
}
