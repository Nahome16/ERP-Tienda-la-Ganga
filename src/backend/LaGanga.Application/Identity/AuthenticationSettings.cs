namespace LaGanga.Application.Identity;

public sealed class AuthenticationSettings
{
    public const string SectionName = "Authentication";

    public TimeSpan MaximumSessionDuration { get; init; } = TimeSpan.FromHours(8);

    public TimeSpan IdleTimeout { get; init; } = TimeSpan.FromMinutes(30);
}
