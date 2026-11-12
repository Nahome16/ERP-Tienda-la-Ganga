namespace LaGanga.Domain.Inventory;

/// <summary>
/// Registro de una impresión de etiquetas de código generado por el sistema: de una talla/color
/// (<see cref="VariantId"/>) o del código de todo el producto (<see cref="VariantId"/> nulo).
/// Sirve para saber qué prendas todavía no tienen etiqueta.
/// </summary>
public sealed class LabelPrint
{
    private LabelPrint()
    {
    }

    public LabelPrint(Guid id, Guid productId, Guid? variantId, int copies, Guid? userId, DateTimeOffset printedAtUtc)
    {
        Id = id;
        ProductId = productId;
        VariantId = variantId;
        Copies = copies;
        UserId = userId;
        PrintedAtUtc = printedAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid ProductId { get; private set; }

    public Guid? VariantId { get; private set; }

    public int Copies { get; private set; }

    public Guid? UserId { get; private set; }

    public DateTimeOffset PrintedAtUtc { get; private set; }
}
