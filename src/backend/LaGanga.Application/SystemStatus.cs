namespace LaGanga.Application;

public sealed record SystemStatus(
    string Service,
    string Status,
    string TimeZone,
    DateTimeOffset CheckedAtUtc)
{
    public static SystemStatus Healthy(DateTimeOffset checkedAtUtc) =>
        new("La Ganga ERP API", "healthy", "America/Managua", checkedAtUtc);
}
