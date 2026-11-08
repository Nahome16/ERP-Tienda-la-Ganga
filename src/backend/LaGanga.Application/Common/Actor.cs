using LaGanga.Domain.Identity;

namespace LaGanga.Application.Common;

/// <summary>Quién hace la solicitud y qué puede hacer, tomado de la sesión validada.</summary>
public sealed record Actor(Guid UserId, IReadOnlyCollection<string> Permissions)
{
    public bool Has(string permission) => Permissions.Contains(permission, StringComparer.Ordinal);

    public bool CanSeeCosts => Has(PermissionNames.InventoryCostRead);
}

/// <summary>Hora de negocio: America/Managua es UTC−6 todo el año (sin horario de verano).</summary>
public static class BusinessTime
{
    public static readonly TimeSpan ManaguaOffset = TimeSpan.FromHours(-6);

    public static (DateTimeOffset StartUtc, DateTimeOffset EndUtc) DayRangeUtc(DateOnly date)
    {
        var start = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), ManaguaOffset).ToUniversalTime();
        return (start, start.AddDays(1));
    }

    public static DateOnly ToBusinessDate(DateTimeOffset moment) =>
        DateOnly.FromDateTime(moment.ToOffset(ManaguaOffset).DateTime);
}
