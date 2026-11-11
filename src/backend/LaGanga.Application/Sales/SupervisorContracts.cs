using LaGanga.Application.Common;

namespace LaGanga.Application.Sales;

/// <summary>Usuario y contraseña de quien autoriza en la caja (por ejemplo el administrador).</summary>
public sealed record SupervisorCredentials(string? Username, string? Password);

/// <summary>Quién autorizó: su cuenta (con sus permisos) y su nombre para la auditoría.</summary>
public sealed record AuthorizedSupervisor(Actor Actor, string DisplayName);

/// <summary>Anulación pedida desde la caja: el motivo y, si quien la pide no puede anular, la autorización.</summary>
public sealed record PosVoidRequest(string? Reason, string? ApproverUsername, string? ApproverPassword);

/// <summary>
/// Comprueba en el momento el usuario y la contraseña de quien autoriza una acción en la caja
/// (anular una venta, registrar un cambio) y que tenga el permiso necesario.
/// </summary>
public interface ISupervisorVerifier
{
    Task<ServiceResult<AuthorizedSupervisor>> VerifyAsync(SupervisorCredentials credentials, string permission, string action, CancellationToken cancellationToken);
}

public interface IPosVoidService
{
    /// <summary>Anula una venta desde la caja. Si el cajero no puede anular, exige la autorización de quien sí puede.</summary>
    Task<ServiceResult<SaleDto>> VoidFromPosAsync(Guid saleId, PosVoidRequest request, Actor requester, CancellationToken cancellationToken);
}
