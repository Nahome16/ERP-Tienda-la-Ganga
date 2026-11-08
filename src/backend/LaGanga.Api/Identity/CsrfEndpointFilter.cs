using System.Security.Claims;
using LaGanga.Application.Identity;

namespace LaGanga.Api.Identity;

/// <summary>
/// Exige el encabezado X-CSRF-Token en operaciones que cambian datos. Debe
/// coincidir con la cookie CSRF y con el token guardado para la sesión.
/// </summary>
public sealed class CsrfEndpointFilter(AuthService authService) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var httpContext = context.HttpContext;
        var sessionValue = httpContext.User.FindFirstValue(AuthConstants.SessionIdClaim);
        var headerToken = httpContext.Request.Headers[AuthConstants.CsrfHeaderName].ToString();
        var cookieToken = httpContext.Request.Cookies[AuthConstants.CsrfCookieName];

        var isValid = Guid.TryParse(sessionValue, out var sessionId) &&
            !string.IsNullOrWhiteSpace(headerToken) &&
            string.Equals(headerToken, cookieToken, StringComparison.Ordinal) &&
            await authService.ValidateCsrfAsync(sessionId, headerToken, httpContext.RequestAborted);

        if (!isValid)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: "No fue posible validar la solicitud. Recargá la página e intentá de nuevo.",
                extensions: new Dictionary<string, object?> { ["code"] = "invalid_csrf" });
        }

        return await next(context);
    }
}

public static class CsrfEndpointFilterExtensions
{
    public static TBuilder RequireCsrf<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter<TBuilder, CsrfEndpointFilter>();
}
