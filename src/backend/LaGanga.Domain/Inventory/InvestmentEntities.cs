namespace LaGanga.Domain.Inventory;

/// <summary>Socio o aportante: quien puso el dinero o trajo la mercadería. No necesita usar el sistema.</summary>
public sealed class Partner
{
    public const int NameMaxLength = 120;

    private Partner()
    {
    }

    public Partner(Guid id, string name, string? phone, string? notes, Guid? createdBy, DateTimeOffset createdAtUtc)
    {
        Id = id;
        Rename(name);
        Phone = Clean(phone);
        Notes = Clean(notes);
        IsActive = true;
        CreatedBy = createdBy;
        CreatedAtUtc = createdAtUtc;
        Version = 1;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string NormalizedName { get; private set; } = string.Empty;

    public string? Phone { get; private set; }

    public string? Notes { get; private set; }

    public bool IsActive { get; private set; }

    public Guid? CreatedBy { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public long Version { get; private set; }

    public void Update(string name, string? phone, string? notes, bool isActive)
    {
        Rename(name);
        Phone = Clean(phone);
        Notes = Clean(notes);
        IsActive = isActive;
    }

    private void Rename(string name)
    {
        var visible = Catalog.CatalogText.CleanVisibleName(name);
        Name = visible;
        NormalizedName = Catalog.CatalogText.Normalize(visible);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public enum LotSource
{
    InitialStock,
    Entry,
    Adjustment,
    Import,
    /// <summary>Saldo que existía antes de llevar el control por socio.</summary>
    Opening,
    /// <summary>Unidades devueltas por una anulación o necesarias para cuadrar; no cuentan como inversión.</summary>
    Restock,
}

/// <summary>
/// Una entrada de mercadería de una variante: con su socio, su costo y el precio que se le dio.
/// Las ventas y pérdidas descuentan primero la entrada más antigua (PEPS).
/// </summary>
public sealed class StockLot
{
    private StockLot()
    {
    }

    public StockLot(
        Guid id,
        Guid variantId,
        Guid? partnerId,
        LotSource source,
        int quantityIn,
        int quantityRemaining,
        decimal? unitCost,
        decimal? unitPrice,
        string? note,
        Guid? enteredBy,
        DateTimeOffset enteredAtUtc)
    {
        Id = id;
        VariantId = variantId;
        PartnerId = partnerId;
        Source = source;
        QuantityIn = quantityIn;
        QuantityRemaining = quantityRemaining;
        UnitCost = unitCost;
        UnitPrice = unitPrice;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        EnteredBy = enteredBy;
        EnteredAtUtc = enteredAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid VariantId { get; private set; }

    public Guid? PartnerId { get; private set; }

    public LotSource Source { get; private set; }

    public int QuantityIn { get; private set; }

    public int QuantityRemaining { get; set; }

    public decimal? UnitCost { get; private set; }

    public decimal? UnitPrice { get; private set; }

    public string? Note { get; private set; }

    public Guid? EnteredBy { get; private set; }

    public DateTimeOffset EnteredAtUtc { get; private set; }

    public void Edit(Guid? partnerId, decimal? unitCost, decimal? unitPrice, string? note)
    {
        PartnerId = partnerId;
        UnitCost = unitCost;
        UnitPrice = unitPrice;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
    }
}

public enum AllocationKind
{
    Sale,
    Loss,
}

/// <summary>De qué entrada salieron las unidades de una venta o pérdida. Sin entrada = faltante sin asignar.</summary>
public sealed class LotAllocation
{
    private LotAllocation()
    {
    }

    public LotAllocation(
        Guid id,
        Guid? lotId,
        Guid variantId,
        AllocationKind kind,
        int quantity,
        Guid? saleId,
        Guid? saleLineId,
        DateTimeOffset createdAtUtc)
    {
        Id = id;
        LotId = lotId;
        VariantId = variantId;
        Kind = kind;
        Quantity = quantity;
        SaleId = saleId;
        SaleLineId = saleLineId;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid? LotId { get; private set; }

    public Guid VariantId { get; private set; }

    public AllocationKind Kind { get; private set; }

    public int Quantity { get; private set; }

    public Guid? SaleId { get; private set; }

    public Guid? SaleLineId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
