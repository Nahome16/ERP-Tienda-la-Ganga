using System.Text;

namespace LaGanga.Domain.Catalog;

public static class CatalogText
{
    /// <summary>
    /// Quita espacios sobrantes al inicio y al final y reduce los espacios
    /// internos a uno solo, conservando mayúsculas y acentos elegidos.
    /// </summary>
    public static string CleanVisibleName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(value.Length);
        var previousWasSpace = false;
        foreach (var character in value.Trim())
        {
            if (char.IsWhiteSpace(character))
            {
                if (!previousWasSpace)
                {
                    builder.Append(' ');
                }

                previousWasSpace = true;
                continue;
            }

            builder.Append(character);
            previousWasSpace = false;
        }

        return builder.ToString();
    }

    /// <summary>
    /// Valor estable para comparar duplicados sin distinguir mayúsculas.
    /// "  azul   OSCURO " y "Azul oscuro" producen el mismo resultado.
    /// </summary>
    public static string Normalize(string? value) =>
        CleanVisibleName(value).ToUpperInvariant();
}
