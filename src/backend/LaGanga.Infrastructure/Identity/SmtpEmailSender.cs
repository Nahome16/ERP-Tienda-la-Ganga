using System.Net;
using System.Net.Mail;
using System.Text.Encodings.Web;
using LaGanga.Application.Identity;

namespace LaGanga.Infrastructure.Identity;

public sealed class EmailSettings
{
    public const string SectionName = "Email";

    public string Host { get; init; } = string.Empty;

    public int Port { get; init; } = 587;

    public string Username { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;

    public string FromAddress { get; init; } = string.Empty;

    public string FromName { get; init; } = "Tienda La Ganga";

    public bool EnableSsl { get; init; } = true;
}

public sealed class SmtpEmailSender(EmailSettings settings) : IEmailSender
{
    public async Task SendAccessCodeAsync(
        string email,
        string displayName,
        string code,
        DateTimeOffset expiresAtUtc,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(settings.Host) ||
            string.IsNullOrWhiteSpace(settings.FromAddress) ||
            settings.Port is < 1 or > 65535)
        {
            throw new InvalidOperationException("El envío de correo no está configurado. Definí Email:Host, Email:Port y Email:FromAddress.");
        }

        using var message = new MailMessage
        {
            From = new MailAddress(settings.FromAddress, settings.FromName),
            Subject = "Código de acceso a La Ganga ERP",
            IsBodyHtml = true,
            Body = $"<p>Hola {HtmlEncoder.Default.Encode(displayName)},</p>" +
                $"<p>Tu código de verificación es:</p><p style=\"font-size:28px;font-weight:700;letter-spacing:6px\">{code}</p>" +
                $"<p>Vence a las {expiresAtUtc.ToOffset(TimeSpan.FromHours(-6)):hh:mm tt} (hora de Managua). " +
                "Al entrar, el sistema te pedirá crear una contraseña nueva.</p>" +
                "<p>Si no solicitaste este código, ignorá este mensaje.</p>",
        };
        message.To.Add(new MailAddress(email));

        using var client = new SmtpClient(settings.Host, settings.Port)
        {
            EnableSsl = settings.EnableSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            UseDefaultCredentials = false,
        };
        if (!string.IsNullOrWhiteSpace(settings.Username))
        {
            client.Credentials = new NetworkCredential(settings.Username, settings.Password);
        }

        await client.SendMailAsync(message, cancellationToken);
    }
}
