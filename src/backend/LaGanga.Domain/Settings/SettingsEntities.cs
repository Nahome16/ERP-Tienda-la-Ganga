namespace LaGanga.Domain.Settings;

/// <summary>Parámetros de la tienda. Siempre existe una sola fila (Id = 1).</summary>
public sealed class StoreSettings
{
    public const int SingletonId = 1;

    private StoreSettings()
    {
    }

    public int Id { get; private set; } = SingletonId;

    public decimal UsdRate { get; set; }

    public string StoreName { get; set; } = string.Empty;

    public string StoreAddress { get; set; } = string.Empty;

    public string StorePhone { get; set; } = string.Empty;

    /// <summary>Nombre del contribuyente inscrito en la DGI (dueño o razón social).</summary>
    public string OwnerName { get; set; } = string.Empty;

    /// <summary>Número RUC del contribuyente.</summary>
    public string TaxId { get; set; } = string.Empty;

    /// <summary>Leyenda opcional del régimen, por ejemplo «Contribuyente Régimen de Cuota Fija».</summary>
    public string ReceiptLegend { get; set; } = string.Empty;

    public string ReceiptFooter { get; set; } = string.Empty;

    public string[] Banks { get; set; } = [];

    public decimal SellerDiscountLimitPercent { get; set; }

    public int LowStockThreshold { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Guid? UpdatedBy { get; set; }
}

public sealed class AuditEvent
{
    private AuditEvent()
    {
    }

    public AuditEvent(
        Guid id,
        DateTimeOffset occurredAtUtc,
        Guid? userId,
        string action,
        string entityType,
        string entityId,
        string summary)
    {
        Id = id;
        OccurredAtUtc = occurredAtUtc;
        UserId = userId;
        Action = action;
        EntityType = entityType;
        EntityId = entityId;
        Summary = summary;
    }

    public Guid Id { get; private set; }

    public DateTimeOffset OccurredAtUtc { get; private set; }

    public Guid? UserId { get; private set; }

    public string Action { get; private set; } = string.Empty;

    public string EntityType { get; private set; } = string.Empty;

    public string EntityId { get; private set; } = string.Empty;

    public string Summary { get; private set; } = string.Empty;
}
