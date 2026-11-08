using System.Globalization;

namespace LaGanga.Domain.Inventory;

/// <summary>
/// Códigos EAN-13 de uso interno: empiezan con «20» (rango reservado por GS1 para uso
/// dentro de la tienda), diez dígitos correlativos y el dígito de verificación.
/// Cualquier lector de códigos de barras los reconoce.
/// </summary>
public static class Ean13
{
    public const long MaxSequence = 9_999_999_999;

    public static string FromSequence(long sequence)
    {
        if (sequence is < 1 or > MaxSequence)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence));
        }

        var body = "20" + sequence.ToString("D10", CultureInfo.InvariantCulture);
        return body + CheckDigit(body);
    }

    /// <summary>Dígito de verificación de los 12 primeros dígitos.</summary>
    public static char CheckDigit(string twelveDigits)
    {
        ArgumentNullException.ThrowIfNull(twelveDigits);
        if (twelveDigits.Length != 12 || !twelveDigits.All(char.IsAsciiDigit))
        {
            throw new ArgumentException("Se requieren exactamente 12 dígitos.", nameof(twelveDigits));
        }

        var sum = 0;
        for (var index = 0; index < 12; index++)
        {
            var digit = twelveDigits[index] - '0';
            sum += index % 2 == 0 ? digit : digit * 3;
        }

        return (char)('0' + ((10 - (sum % 10)) % 10));
    }

    public static bool IsValid(string? code) =>
        code is { Length: 13 } && code.All(char.IsAsciiDigit) && CheckDigit(code[..12]) == code[12];
}
