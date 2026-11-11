namespace LaGanga.Domain.Sales;

/// <summary>
/// Cambio de talla o color de prendas de una venta: el cliente devuelve unidades de una
/// variante y se lleva otra variante del mismo producto. No mueve dinero: se mantiene el
/// precio cobrado en la venta original. Se numera aparte (CT-000001).
/// </summary>
public sealed class SaleExchange
{
    public const int NoteMaxLength = 500;

    private readonly List<SaleExchangeLine> _lines = [];

    private SaleExchange()
    {
    }

    public SaleExchange(
        Guid id,
        Guid clientExchangeId,
        Guid saleId,
        Guid? cashSessionId,
        Guid userId,
        DateTimeOffset createdAtUtc,
        string? note)
    {
        Id = id;
        ClientExchangeId = clientExchangeId;
        SaleId = saleId;
        CashSessionId = cashSessionId;
        UserId = userId;
        CreatedAtUtc = createdAtUtc;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
    }

    public Guid Id { get; private set; }

    /// <summary>Correlativo asignado por la base de datos (se muestra como CT-000123).</summary>
    public long Number { get; private set; }

    /// <summary>Identificador generado por el equipo: evita registrar dos veces el mismo cambio.</summary>
    public Guid ClientExchangeId { get; private set; }

    public Guid SaleId { get; private set; }

    public Guid? CashSessionId { get; private set; }

    public Guid UserId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public string? Note { get; private set; }

    public IReadOnlyCollection<SaleExchangeLine> Lines => _lines;

    public void AddLine(SaleExchangeLine line) => _lines.Add(line);
}

public sealed class SaleExchangeLine
{
    private SaleExchangeLine()
    {
    }

    public SaleExchangeLine(
        Guid id,
        Guid exchangeId,
        Guid saleLineId,
        string productName,
        int quantity,
        decimal unitPrice,
        Guid returnedVariantId,
        string returnedSizeName,
        string returnedColorName,
        string returnedBarcode,
        Guid newVariantId,
        string newSizeName,
        string newColorName,
        string newBarcode)
    {
        Id = id;
        ExchangeId = exchangeId;
        SaleLineId = saleLineId;
        ProductName = productName;
        Quantity = quantity;
        UnitPrice = unitPrice;
        ReturnedVariantId = returnedVariantId;
        ReturnedSizeName = returnedSizeName;
        ReturnedColorName = returnedColorName;
        ReturnedBarcode = returnedBarcode;
        NewVariantId = newVariantId;
        NewSizeName = newSizeName;
        NewColorName = newColorName;
        NewBarcode = newBarcode;
    }

    public Guid Id { get; private set; }

    public Guid ExchangeId { get; private set; }

    public Guid SaleLineId { get; private set; }

    public string ProductName { get; private set; } = string.Empty;

    public int Quantity { get; private set; }

    /// <summary>Precio cobrado en la venta original (no cambia con el cambio de talla).</summary>
    public decimal UnitPrice { get; private set; }

    public Guid ReturnedVariantId { get; private set; }

    public string ReturnedSizeName { get; private set; } = string.Empty;

    public string ReturnedColorName { get; private set; } = string.Empty;

    public string ReturnedBarcode { get; private set; } = string.Empty;

    public Guid NewVariantId { get; private set; }

    public string NewSizeName { get; private set; } = string.Empty;

    public string NewColorName { get; private set; } = string.Empty;

    public string NewBarcode { get; private set; } = string.Empty;
}

/// <summary>Plazo para cambios, contado en días calendario de Managua.</summary>
public static class ExchangePolicy
{
    public const int DefaultWindowDays = 4;

    public const int MaxWindowDays = 365;

    /// <summary>
    /// Días transcurridos entre la fecha de la venta y hoy. Venta el lunes y cambio el viernes = 4.
    /// </summary>
    public static int DaysSince(DateOnly saleDate, DateOnly today) => today.DayNumber - saleDate.DayNumber;

    /// <summary>Con un plazo de 4 días, una venta del lunes se puede cambiar hasta el viernes inclusive.</summary>
    public static bool IsWithinWindow(DateOnly saleDate, DateOnly today, int windowDays)
    {
        var days = DaysSince(saleDate, today);
        return days >= 0 && days <= windowDays;
    }
}
