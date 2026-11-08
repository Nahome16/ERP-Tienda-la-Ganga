namespace LaGanga.Domain.Catalog;

/// <summary>
/// Regla de catálogo incumplida. <see cref="Code"/> es estable para la API y
/// el mensaje está pensado para mostrarse a la persona usuaria.
/// </summary>
public sealed class CatalogRuleException : Exception
{
    public CatalogRuleException()
        : this("catalog_rule", "La operación no cumple las reglas del catálogo.")
    {
    }

    public CatalogRuleException(string message)
        : this("catalog_rule", message)
    {
    }

    public CatalogRuleException(string message, Exception innerException)
        : base(message, innerException)
    {
        Code = "catalog_rule";
    }

    public CatalogRuleException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}
