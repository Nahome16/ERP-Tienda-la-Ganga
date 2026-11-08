using System.Globalization;
using System.Security.Claims;
using LaGanga.Api.Identity;
using LaGanga.Application.Common;

namespace LaGanga.Api.Mvp;

internal static class ApiHelpers
{
    public static Actor? GetActor(this ClaimsPrincipal principal)
    {
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            return null;
        }

        var permissions = principal.FindAll(AuthConstants.PermissionClaim).Select(claim => claim.Value).ToArray();
        return new Actor(userId, permissions);
    }

    /// <summary>Convierte el resultado de un caso de uso en una respuesta HTTP con código estable.</summary>
    public static IResult ToHttp<T>(this ServiceResult<T> result, Func<T, IResult> onSuccess)
    {
        if (result.Succeeded && result.Value is { } value)
        {
            return onSuccess(value);
        }

        var error = result.Error!;
        var status = error.Kind switch
        {
            ServiceErrorKind.Validation => StatusCodes.Status400BadRequest,
            ServiceErrorKind.NotFound => StatusCodes.Status404NotFound,
            ServiceErrorKind.Conflict => StatusCodes.Status409Conflict,
            ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ServiceErrorKind.Unauthorized => StatusCodes.Status401Unauthorized,
            _ => StatusCodes.Status422UnprocessableEntity,
        };
        var extensions = new Dictionary<string, object?> { ["code"] = error.Code };
        if (error.Field is not null)
        {
            extensions["errors"] = new Dictionary<string, string[]> { [error.Field] = [error.Message] };
        }

        return Results.Problem(statusCode: status, title: error.Message, extensions: extensions);
    }

    public static IResult ToHttp<T>(this ServiceResult<T> result) => result.ToHttp(value => Results.Ok(value));

    public static IResult Unauthorized401() => Results.Unauthorized();

    public static IResult BadRequest(string field, string message) =>
        Results.Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: message,
            extensions: new Dictionary<string, object?>
            {
                ["code"] = "validation_failed",
                ["errors"] = new Dictionary<string, string[]> { [field] = [message] },
            });

    public static IResult MissingIfMatch() =>
        Results.Problem(
            statusCode: StatusCodes.Status428PreconditionRequired,
            title: "Falta la versión del elemento (encabezado If-Match).",
            extensions: new Dictionary<string, object?> { ["code"] = "precondition_required" });

    /// <summary>Acepta <c>"3"</c>, <c>W/"3"</c> o <c>3</c>.</summary>
    public static bool TryReadIfMatch(this HttpContext httpContext, out long version)
    {
        var value = httpContext.Request.Headers.IfMatch.ToString().Trim();
        if (value.StartsWith("W/", StringComparison.Ordinal))
        {
            value = value[2..];
        }

        return long.TryParse(value.Trim('"'), NumberStyles.None, CultureInfo.InvariantCulture, out version);
    }

    public static string ETag(long version) => string.Create(CultureInfo.InvariantCulture, $"\"{version}\"");
}
