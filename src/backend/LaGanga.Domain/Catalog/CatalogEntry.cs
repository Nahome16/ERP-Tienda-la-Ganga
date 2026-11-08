namespace LaGanga.Domain.Catalog;

/// <summary>
/// Datos comunes de todos los catálogos editables: nombre visible, nombre
/// normalizado para evitar duplicados, estado, orden, auditoría y versión.
/// </summary>
public abstract class CatalogEntry
{
    protected CatalogEntry()
    {
    }

    protected CatalogEntry(
        Guid id,
        string name,
        int sortOrder,
        Guid? createdBy,
        DateTimeOffset createdAtUtc)
    {
        Id = id;
        SetName(name);
        SetSortOrder(sortOrder);
        IsActive = true;
        CreatedAtUtc = createdAtUtc;
        CreatedBy = createdBy;
        UpdatedAtUtc = createdAtUtc;
        UpdatedBy = createdBy;
        Version = 1;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string NormalizedName { get; private set; } = string.Empty;

    public bool IsActive { get; private set; }

    public int SortOrder { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public Guid? CreatedBy { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public Guid? UpdatedBy { get; private set; }

    public long Version { get; private set; }

    public void Update(string name, int sortOrder, Guid? updatedBy, DateTimeOffset updatedAtUtc)
    {
        SetName(name);
        SetSortOrder(sortOrder);
        Touch(updatedBy, updatedAtUtc);
    }

    public void Activate(Guid? updatedBy, DateTimeOffset updatedAtUtc)
    {
        if (IsActive)
        {
            return;
        }

        IsActive = true;
        Touch(updatedBy, updatedAtUtc);
    }

    public void Inactivate(Guid? updatedBy, DateTimeOffset updatedAtUtc)
    {
        if (!IsActive)
        {
            return;
        }

        IsActive = false;
        Touch(updatedBy, updatedAtUtc);
    }

    /// <summary>
    /// Registra quién y cuándo modificó el elemento. La versión se incrementa
    /// una sola vez por guardado, en la capa de persistencia.
    /// </summary>
    protected void Touch(Guid? updatedBy, DateTimeOffset updatedAtUtc)
    {
        UpdatedBy = updatedBy;
        UpdatedAtUtc = updatedAtUtc;
    }

    private void SetName(string name)
    {
        var visible = CatalogText.CleanVisibleName(name);
        if (visible.Length == 0)
        {
            throw new CatalogRuleException("name_required", "El nombre es obligatorio.");
        }

        Name = visible;
        NormalizedName = CatalogText.Normalize(visible);
    }

    private void SetSortOrder(int sortOrder)
    {
        if (sortOrder < 0)
        {
            throw new CatalogRuleException("invalid_sort_order", "El orden debe ser cero o mayor.");
        }

        SortOrder = sortOrder;
    }
}
