namespace LaGanga.Domain.Inventory;

/// <summary>
/// Código de fábrica de un color de un producto: lo comparten todas las tallas de ese color
/// (por ejemplo, el pantalón Negro trae un código y el Azul otro). Al escanearlo, la caja abre el
/// producto en ese color para elegir la talla.
/// </summary>
public sealed class ProductColorBarcode
{
    public ProductColorBarcode(Guid id, Guid productId, Guid colorId, string barcode, DateTimeOffset createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(barcode))
        {
            throw new ArgumentException("El código es obligatorio.", nameof(barcode));
        }

        Id = id;
        ProductId = productId;
        ColorId = colorId;
        Barcode = barcode.Trim();
        CreatedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid ProductId { get; private set; }

    public Guid ColorId { get; private set; }

    public string Barcode { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public void ChangeBarcode(string barcode)
    {
        if (string.IsNullOrWhiteSpace(barcode))
        {
            throw new ArgumentException("El código es obligatorio.", nameof(barcode));
        }

        Barcode = barcode.Trim();
    }
}
