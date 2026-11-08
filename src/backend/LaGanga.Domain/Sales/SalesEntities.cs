namespace LaGanga.Domain.Sales;

public enum SaleChannel
{
    Store,
    WhatsApp,
    Facebook,
}

public enum PaymentMethod
{
    Cash,
    Transfer,
    Card,
}

public enum Currency
{
    NIO,
    USD,
}

public enum DiscountType
{
    Percent,
    Amount,
}

public enum SaleStatus
{
    Confirmed,
    Voided,
}

public sealed class CashRegister
{
    public const int NameMaxLength = 60;

    private CashRegister()
    {
    }

    public CashRegister(Guid id, string name)
    {
        Id = id;
        Name = name;
        IsActive = true;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public bool IsActive { get; private set; }
}

public sealed class CashSession
{
    private CashSession()
    {
    }

    public CashSession(
        Guid id,
        Guid registerId,
        Guid openedByUserId,
        DateTimeOffset openedAtUtc,
        decimal openingFloatNio,
        decimal openingFloatUsd)
    {
        Id = id;
        RegisterId = registerId;
        OpenedByUserId = openedByUserId;
        OpenedAtUtc = openedAtUtc;
        OpeningFloatNio = openingFloatNio;
        OpeningFloatUsd = openingFloatUsd;
    }

    public Guid Id { get; private set; }

    public Guid RegisterId { get; private set; }

    public CashRegister Register { get; private set; } = null!;

    public Guid OpenedByUserId { get; private set; }

    public DateTimeOffset OpenedAtUtc { get; private set; }

    public decimal OpeningFloatNio { get; private set; }

    public decimal OpeningFloatUsd { get; private set; }

    public DateTimeOffset? ClosedAtUtc { get; private set; }

    public Guid? ClosedByUserId { get; private set; }

    public decimal? CountedCashNio { get; private set; }

    public decimal? CountedCashUsd { get; private set; }

    /// <summary>Total de transferencias verificado en el banco (null = no se verificó).</summary>
    public decimal? CountedTransferNio { get; private set; }

    public decimal? CountedTransferUsd { get; private set; }

    /// <summary>Total de tarjeta según el cierre de lote de la terminal (null = no se verificó).</summary>
    public decimal? CountedCardNio { get; private set; }

    public decimal? CountedCardUsd { get; private set; }

    public string? ClosingNotes { get; private set; }

    public bool IsOpen => ClosedAtUtc is null;

    public void Close(
        Guid closedByUserId,
        DateTimeOffset closedAtUtc,
        decimal countedCashNio,
        decimal countedCashUsd,
        string? notes,
        decimal? countedTransferNio = null,
        decimal? countedTransferUsd = null,
        decimal? countedCardNio = null,
        decimal? countedCardUsd = null)
    {
        ClosedByUserId = closedByUserId;
        ClosedAtUtc = closedAtUtc;
        CountedCashNio = countedCashNio;
        CountedCashUsd = countedCashUsd;
        CountedTransferNio = countedTransferNio;
        CountedTransferUsd = countedTransferUsd;
        CountedCardNio = countedCardNio;
        CountedCardUsd = countedCardUsd;
        ClosingNotes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
    }
}

public sealed class Sale
{
    private readonly List<SaleLine> _lines = [];
    private readonly List<SalePayment> _payments = [];

    private Sale()
    {
    }

    public Sale(
        Guid id,
        Guid clientSaleId,
        Guid cashSessionId,
        Guid sellerUserId,
        SaleChannel channel,
        DateTimeOffset createdAtUtc,
        DateTimeOffset receivedAtUtc,
        bool isOffline,
        string? note)
    {
        Id = id;
        ClientSaleId = clientSaleId;
        CashSessionId = cashSessionId;
        SellerUserId = sellerUserId;
        Channel = channel;
        CreatedAtUtc = createdAtUtc;
        ReceivedAtUtc = receivedAtUtc;
        IsOffline = isOffline;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        Status = SaleStatus.Confirmed;
    }

    public Guid Id { get; private set; }

    /// <summary>Número correlativo asignado por la base de datos (se muestra como V-000123).</summary>
    public long Number { get; private set; }

    public Guid ClientSaleId { get; private set; }

    public Guid CashSessionId { get; private set; }

    public CashSession CashSession { get; private set; } = null!;

    public Guid SellerUserId { get; private set; }

    public SaleChannel Channel { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset ReceivedAtUtc { get; private set; }

    public bool IsOffline { get; private set; }

    public decimal SubtotalNio { get; private set; }

    public DiscountType? DiscountType { get; private set; }

    public decimal? DiscountValue { get; private set; }

    public decimal DiscountNio { get; private set; }

    public decimal TotalNio { get; private set; }

    public decimal ChangeNio { get; private set; }

    public SaleStatus Status { get; private set; }

    public bool RequiresReview { get; private set; }

    public string? ReviewNote { get; private set; }

    public string? Note { get; private set; }

    public Guid? DiscountApprovalId { get; private set; }

    public DateTimeOffset? VoidedAtUtc { get; private set; }

    public Guid? VoidedByUserId { get; private set; }

    public string? VoidReason { get; private set; }

    public IReadOnlyCollection<SaleLine> Lines => _lines;

    public IReadOnlyCollection<SalePayment> Payments => _payments;

    public void SetTotals(
        decimal subtotalNio,
        DiscountType? discountType,
        decimal? discountValue,
        decimal discountNio,
        decimal totalNio,
        decimal changeNio,
        Guid? discountApprovalId)
    {
        SubtotalNio = subtotalNio;
        DiscountType = discountType;
        DiscountValue = discountValue;
        DiscountNio = discountNio;
        TotalNio = totalNio;
        ChangeNio = changeNio;
        DiscountApprovalId = discountApprovalId;
    }

    public void AddLine(SaleLine line) => _lines.Add(line);

    public void AddPayment(SalePayment payment) => _payments.Add(payment);

    public void FlagForReview(string note)
    {
        RequiresReview = true;
        ReviewNote = string.IsNullOrEmpty(ReviewNote) ? note : $"{ReviewNote} {note}";
    }

    public void ResolveReview(string note)
    {
        RequiresReview = false;
        ReviewNote = string.IsNullOrWhiteSpace(note) ? ReviewNote : $"{ReviewNote} Resuelto: {note.Trim()}";
    }

    public void Void(Guid userId, DateTimeOffset voidedAtUtc, string reason)
    {
        Status = SaleStatus.Voided;
        VoidedByUserId = userId;
        VoidedAtUtc = voidedAtUtc;
        VoidReason = reason.Trim();
    }
}

public sealed class SaleLine
{
    private SaleLine()
    {
    }

    public SaleLine(
        Guid id,
        Guid saleId,
        Guid variantId,
        string productName,
        string sizeName,
        string colorName,
        string barcode,
        int quantity,
        decimal unitPrice,
        decimal lineTotalNio)
    {
        Id = id;
        SaleId = saleId;
        VariantId = variantId;
        ProductName = productName;
        SizeName = sizeName;
        ColorName = colorName;
        Barcode = barcode;
        Quantity = quantity;
        UnitPrice = unitPrice;
        LineTotalNio = lineTotalNio;
    }

    public Guid Id { get; private set; }

    public Guid SaleId { get; private set; }

    public Guid VariantId { get; private set; }

    public string ProductName { get; private set; } = string.Empty;

    public string SizeName { get; private set; } = string.Empty;

    public string ColorName { get; private set; } = string.Empty;

    public string Barcode { get; private set; } = string.Empty;

    public int Quantity { get; private set; }

    public decimal UnitPrice { get; private set; }

    public decimal LineTotalNio { get; private set; }
}

public sealed class SalePayment
{
    private SalePayment()
    {
    }

    public SalePayment(
        Guid id,
        Guid saleId,
        PaymentMethod method,
        Currency currency,
        decimal amount,
        decimal? exchangeRate,
        decimal amountNio,
        string? bank,
        string? reference)
    {
        Id = id;
        SaleId = saleId;
        Method = method;
        Currency = currency;
        Amount = amount;
        ExchangeRate = exchangeRate;
        AmountNio = amountNio;
        Bank = bank;
        Reference = reference;
    }

    public Guid Id { get; private set; }

    public Guid SaleId { get; private set; }

    public PaymentMethod Method { get; private set; }

    public Currency Currency { get; private set; }

    public decimal Amount { get; private set; }

    public decimal? ExchangeRate { get; private set; }

    public decimal AmountNio { get; private set; }

    public string? Bank { get; private set; }

    public string? Reference { get; private set; }
}

/// <summary>Autorización de un administrador para un descuento sobre el límite del vendedor. Un solo uso.</summary>
public sealed class DiscountApproval
{
    private DiscountApproval()
    {
    }

    public DiscountApproval(
        Guid id,
        Guid approverUserId,
        Guid requestedByUserId,
        DateTimeOffset createdAtUtc,
        DateTimeOffset expiresAtUtc)
    {
        Id = id;
        ApproverUserId = approverUserId;
        RequestedByUserId = requestedByUserId;
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = expiresAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid ApproverUserId { get; private set; }

    public Guid RequestedByUserId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }

    public Guid? UsedBySaleId { get; private set; }

    public void MarkUsed(Guid saleId) => UsedBySaleId = saleId;
}
