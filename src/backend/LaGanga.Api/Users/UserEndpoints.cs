using System.Security.Claims;
using LaGanga.Api.Identity;
using LaGanga.Application.Users;
using LaGanga.Domain.Identity;

namespace LaGanga.Api.Users;

public static class UserEndpoints
{
    public static IEndpointRouteBuilder MapUserEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/users")
            .WithTags("Users")
            .RequireAuthorization(PermissionNames.UserManage);

        group.MapGet("/", async (IUserAdminService service, CancellationToken cancellationToken) =>
            Results.Ok(await service.ListUsersAsync(cancellationToken)));

        group.MapGet("/roles", async (IUserAdminService service, CancellationToken cancellationToken) =>
            Results.Ok(await service.ListRolesAsync(cancellationToken)));

        group.MapPost("/", async (
                CreateUserRequest request,
                IUserAdminService service,
                CancellationToken cancellationToken) =>
            {
                var result = await service.CreateAsync(
                    new CreateUserInput(request.Username, request.DisplayName, request.Password, request.RoleIds),
                    cancellationToken);
                return ToResult(result, user => Results.Created($"/api/v1/users/{user.Id}", user));
            })
            .RequireCsrf();

        group.MapPut("/{id:guid}", async (
                Guid id,
                UpdateUserRequest request,
                IUserAdminService service,
                ClaimsPrincipal principal,
                CancellationToken cancellationToken) =>
            {
                if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var actorId))
                {
                    return Results.Unauthorized();
                }

                var result = await service.UpdateAsync(
                    id,
                    new UpdateUserInput(request.DisplayName, request.RoleIds, request.IsActive),
                    actorId,
                    cancellationToken);
                return ToResult(result, user => Results.Ok(user));
            })
            .RequireCsrf();

        group.MapPost("/{id:guid}/password", async (
                Guid id,
                ResetPasswordRequest request,
                IUserAdminService service,
                CancellationToken cancellationToken) =>
            {
                var result = await service.ResetPasswordAsync(id, request.Password, cancellationToken);
                return ToResult(result, user => Results.Ok(user));
            })
            .RequireCsrf();

        return endpoints;
    }

    private static IResult ToResult(
        UserAdminResult<UserSummaryDto> result,
        Func<UserSummaryDto, IResult> onSuccess)
    {
        if (result.Succeeded && result.Value is { } user)
        {
            return onSuccess(user);
        }

        var error = result.Error!;
        var status = error.Kind switch
        {
            UserAdminErrorKind.Validation => StatusCodes.Status400BadRequest,
            UserAdminErrorKind.NotFound => StatusCodes.Status404NotFound,
            UserAdminErrorKind.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status422UnprocessableEntity,
        };
        var extensions = new Dictionary<string, object?> { ["code"] = error.Code };
        if (error.Field is not null)
        {
            extensions["errors"] = new Dictionary<string, string[]> { [error.Field] = [error.Message] };
        }

        return Results.Problem(statusCode: status, title: error.Message, extensions: extensions);
    }
}

public sealed record CreateUserRequest(
    string? Username,
    string? DisplayName,
    string? Password,
    IReadOnlyList<Guid>? RoleIds);

public sealed record UpdateUserRequest(
    string? DisplayName,
    IReadOnlyList<Guid>? RoleIds,
    bool? IsActive);

public sealed record ResetPasswordRequest(string? Password);
