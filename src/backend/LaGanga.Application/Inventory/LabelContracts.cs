using LaGanga.Application.Common;

namespace LaGanga.Application.Inventory;

/// <summary>
/// Una etiqueta de código generado por el sistema. <c>VariantId</c> nulo = código de todo el
/// producto (en caja se elige la talla). <c>Pending</c>: hay existencia y nunca se imprimió, o
/// entró mercadería después de la última impresión.
/// </summary>
public sealed record LabelRowDto(
    Guid ProductId,
    Guid? VariantId,
    string ProductName,
    string? SizeName,
    string? ColorName,
    string? ColorHex,
    string Barcode,
    decimal Price,
    int Stock,
    string? ImageUrl,
    DateTimeOffset? LastPrintedAtUtc,
    int LastCopies,
    bool Pending);

public sealed record LabelQuery(string? Search, string? Status, int Page, int PageSize);

public sealed record LabelPrintItem(Guid ProductId, Guid? VariantId, int Copies);

public sealed record LabelPrintedInput(IReadOnlyList<LabelPrintItem>? Items);

public interface ILabelService
{
    Task<PageResult<LabelRowDto>> ListAsync(LabelQuery query, CancellationToken cancellationToken);

    Task<ServiceResult<int>> MarkPrintedAsync(LabelPrintedInput input, Actor actor, CancellationToken cancellationToken);
}
