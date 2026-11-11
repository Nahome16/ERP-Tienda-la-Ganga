using LaGanga.Application.Common;
using LaGanga.Application.Identity;
using LaGanga.Application.Sales;
using LaGanga.Application.Settings;
using LaGanga.Domain.Identity;

namespace LaGanga.Infrastructure.Sales;

public sealed class SupervisorVerifier(IIdentityStore identityStore, IPasswordService passwordService) : ISupervisorVerifier
{
    public async Task<ServiceResult<AuthorizedSupervisor>> VerifyAsync(
        SupervisorCredentials credentials,
        string permission,
        string action,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(credentials);

        if (string.IsNullOrWhiteSpace(credentials.Username) || string.IsNullOrEmpty(credentials.Password) || credentials.Password.Length > 256)
        {
            return Result.Fail<AuthorizedSupervisor>(ServiceErrorKind.Forbidden, "approval_required", $"Para {action} hace falta la autorización del administrador: su usuario y contraseña.");
        }

        var approver = await identityStore.FindUserByNormalizedUsernameAsync(UserAccount.NormalizeUsername(credentials.Username), cancellationToken);
        if (approver is null || !approver.IsActive || !passwordService.VerifyPassword(approver, approver.PasswordHash, credentials.Password))
        {
            return Result.Fail<AuthorizedSupervisor>(ServiceErrorKind.Unprocessable, "invalid_credentials", "Usuario o contraseña del administrador incorrectos.");
        }

        var permissions = approver.Roles.SelectMany(role => role.Role.Permissions).Select(grant => grant.Permission.Name).Distinct(StringComparer.Ordinal).ToArray();
        if (!permissions.Contains(permission, StringComparer.Ordinal))
        {
            return Result.Fail<AuthorizedSupervisor>(ServiceErrorKind.Forbidden, "approver_not_allowed", $"Esa cuenta no puede autorizar {action}.");
        }

        return Result.Ok(new AuthorizedSupervisor(new Actor(approver.Id, permissions), approver.DisplayName));
    }
}

public sealed class PosVoidService(ISalesService sales, ISupervisorVerifier verifier, IAuditWriter audit) : IPosVoidService
{
    public async Task<ServiceResult<SaleDto>> VoidFromPosAsync(Guid saleId, PosVoidRequest request, Actor requester, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(requester);

        if (requester.Has(PermissionNames.SaleVoid))
        {
            return await sales.VoidAsync(saleId, new VoidSaleRequest(request.Reason), requester, cancellationToken);
        }

        var approval = await verifier.VerifyAsync(
            new SupervisorCredentials(request.ApproverUsername, request.ApproverPassword), PermissionNames.SaleVoid, "anular una venta", cancellationToken);
        if (!approval.Succeeded)
        {
            return Result.Fail<SaleDto>(approval.Error!);
        }

        var supervisor = approval.Value!;
        audit.Add(requester.UserId, "sale.void_requested", "Sale", saleId.ToString(), $"Anulación pedida en la caja y autorizada por {supervisor.DisplayName}.");
        return await sales.VoidAsync(saleId, new VoidSaleRequest(request.Reason), supervisor.Actor, cancellationToken);
    }
}
