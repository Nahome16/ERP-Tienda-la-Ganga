using System.Security.Claims;
using LaGanga.Application.Identity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.RateLimiting;

namespace LaGanga.Api.Identity;

public static class AuthenticationEndpoints
{
    public const string MustChangePasswordClaim = "must_change_password";
    public const string EmailCodeVerifiedClaim = "email_code_verified";

    public static IEndpointRouteBuilder MapAuthenticationEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/auth").WithTags("Authentication");

        group.MapPost("/login", LoginAsync)
            .AllowAnonymous()
            .RequireRateLimiting(AuthConstants.LoginRateLimitPolicy);
        group.MapPost("/code/request", RequestCodeAsync)
            .AllowAnonymous()
            .RequireRateLimiting(AuthConstants.LoginRateLimitPolicy);
        group.MapPost("/code/verify", VerifyCodeAsync)
            .AllowAnonymous()
            .RequireRateLimiting(AuthConstants.LoginRateLimitPolicy);
        group.MapGet("/me", GetCurrentUser).RequireAuthorization();
        group.MapPost("/password", ChangePasswordAsync).RequireAuthorization().RequireCsrf();
        group.MapPost("/logout", LogoutAsync).RequireAuthorization();
        group.MapGet("/permissions/inventory-cost", () => Results.NoContent())
            .RequireAuthorization(AuthConstants.InventoryCostPolicy);

        return endpoints;
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        AuthService authService,
        HttpContext httpContext,
        IHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var result = await authService.LoginAsync(
            new LoginCommand(request.Username, request.Password),
            cancellationToken);

        if (!result.Succeeded)
        {
            var status = result.Failure == LoginFailure.InvalidRequest
                ? StatusCodes.Status400BadRequest
                : StatusCodes.Status401Unauthorized;
            var code = result.Failure == LoginFailure.InvalidRequest
                ? "validation_failed"
                : "invalid_credentials";
            var message = result.Failure == LoginFailure.InvalidRequest
                ? "Revisá el usuario y la contraseña ingresados."
                : "El usuario o la contraseña no son válidos.";
            return Results.Problem(statusCode: status, title: message, extensions: new Dictionary<string, object?>
            {
                ["code"] = code,
            });
        }

        await SignInAsync(result, httpContext, environment);

        return Results.Ok(new LoginResponse(result.User!, result.ExpiresAtUtc!.Value));
    }

    private static async Task<IResult> RequestCodeAsync(
        AccessCodeRequest request,
        IAccountAccessService service,
        CancellationToken cancellationToken)
    {
        await service.RequestCodeAsync(request.Email, cancellationToken);
        return Results.Accepted(value: new
        {
            message = "Si el correo corresponde a una cuenta activa, enviaremos un código de verificación.",
        });
    }

    private static async Task<IResult> VerifyCodeAsync(
        VerifyCodeRequest request,
        IAccountAccessService service,
        HttpContext httpContext,
        IHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var result = await service.VerifyCodeAsync(request.Email, request.Code, cancellationToken);
        if (!result.Succeeded || result.Login is null)
        {
            var status = result.Failure == AccessCodeFailure.InvalidRequest
                ? StatusCodes.Status400BadRequest
                : StatusCodes.Status401Unauthorized;
            return Results.Problem(
                statusCode: status,
                title: result.Failure == AccessCodeFailure.InvalidRequest
                    ? "Revisá el correo y el código ingresados."
                    : "El código no es válido, venció o agotó sus intentos.",
                extensions: new Dictionary<string, object?>
                {
                    ["code"] = result.Failure == AccessCodeFailure.InvalidRequest ? "validation_failed" : "invalid_code",
                });
        }

        await SignInAsync(result.Login, httpContext, environment, emailCodeVerified: true);
        return Results.Ok(new LoginResponse(result.Login.User!, result.Login.ExpiresAtUtc!.Value));
    }

    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        IAccountAccessService service,
        ClaimsPrincipal principal,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ||
            !Guid.TryParse(principal.FindFirstValue(AuthConstants.SessionIdClaim), out var sessionId))
        {
            return Results.Unauthorized();
        }

        var result = await service.ChangePasswordAsync(
            userId,
            sessionId,
            string.Equals(
                principal.FindFirstValue(EmailCodeVerifiedClaim),
                bool.TrueString,
                StringComparison.OrdinalIgnoreCase),
            request.CurrentPassword,
            request.NewPassword,
            cancellationToken);
        if (result.Succeeded)
        {
            return Results.Ok(result.User);
        }

        var (status, code, message) = result.Failure switch
        {
            PasswordChangeFailure.InvalidCurrentPassword =>
                (StatusCodes.Status401Unauthorized, "invalid_current_password", "La contraseña actual no es válida."),
            PasswordChangeFailure.UserNotFound =>
                (StatusCodes.Status404NotFound, "not_found", "No encontramos la cuenta."),
            _ =>
                (StatusCodes.Status400BadRequest, "validation_failed", "La nueva contraseña debe tener entre 12 y 256 caracteres."),
        };
        return Results.Problem(statusCode: status, title: message, extensions: new Dictionary<string, object?> { ["code"] = code });
    }

    private static IResult GetCurrentUser(ClaimsPrincipal principal)
    {
        var idValue = principal.FindFirstValue(ClaimTypes.NameIdentifier) ??
            principal.FindFirstValue("sub");
        if (!Guid.TryParse(idValue, out var userId))
        {
            return Results.Unauthorized();
        }

        var roles = principal.FindAll(ClaimTypes.Role)
            .Select(claim => claim.Value)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var permissions = principal.FindAll(AuthConstants.PermissionClaim)
            .Select(claim => claim.Value)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

        return Results.Ok(new CurrentUser(
            userId,
            principal.Identity?.Name ?? string.Empty,
            principal.FindFirstValue("name") ?? string.Empty,
            roles,
            permissions,
            string.Equals(principal.FindFirstValue(MustChangePasswordClaim), bool.TrueString, StringComparison.OrdinalIgnoreCase)));
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext httpContext,
        AuthService authService,
        IHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var sessionValue = httpContext.User.FindFirstValue(AuthConstants.SessionIdClaim);
        var headerToken = httpContext.Request.Headers[AuthConstants.CsrfHeaderName].ToString();
        var cookieToken = httpContext.Request.Cookies[AuthConstants.CsrfCookieName];

        if (!Guid.TryParse(sessionValue, out var sessionId) ||
            string.IsNullOrWhiteSpace(cookieToken) ||
            !string.Equals(headerToken, cookieToken, StringComparison.Ordinal) ||
            !await authService.LogoutAsync(sessionId, headerToken, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "No fue posible validar la solicitud.",
                extensions: new Dictionary<string, object?> { ["code"] = "invalid_csrf" });
        }

        await httpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        DeleteCsrfCookie(httpContext.Response.Cookies, environment.IsProduction());
        return Results.NoContent();
    }

    private static ClaimsPrincipal CreatePrincipal(CurrentUser user, Guid sessionId, bool emailCodeVerified)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new("name", user.DisplayName),
            new(AuthConstants.SessionIdClaim, sessionId.ToString()),
            new(MustChangePasswordClaim, user.MustChangePassword.ToString()),
            new(EmailCodeVerifiedClaim, emailCodeVerified.ToString()),
        };
        claims.AddRange(user.Roles.Select(role => new Claim(ClaimTypes.Role, role)));
        claims.AddRange(user.Permissions.Select(
            permission => new Claim(AuthConstants.PermissionClaim, permission)));
        var identity = new ClaimsIdentity(
            claims,
            CookieAuthenticationDefaults.AuthenticationScheme,
            ClaimTypes.Name,
            ClaimTypes.Role);
        return new ClaimsPrincipal(identity);
    }

    private static async Task SignInAsync(
        LoginResult result,
        HttpContext httpContext,
        IHostEnvironment environment,
        bool emailCodeVerified = false)
    {
        var principal = CreatePrincipal(result.User!, result.SessionId!.Value, emailCodeVerified);
        await httpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            principal,
            new AuthenticationProperties
            {
                AllowRefresh = false,
                ExpiresUtc = result.ExpiresAtUtc,
                IsPersistent = true,
            });
        AppendCsrfCookie(
            httpContext.Response.Cookies,
            result.CsrfToken!,
            result.ExpiresAtUtc!.Value,
            environment.IsProduction());
    }

    private static void AppendCsrfCookie(
        IResponseCookies cookies,
        string csrfToken,
        DateTimeOffset expiresAtUtc,
        bool isProduction)
    {
        cookies.Append(AuthConstants.CsrfCookieName, csrfToken, new CookieOptions
        {
            Expires = expiresAtUtc,
            HttpOnly = false,
            IsEssential = true,
            SameSite = SameSiteMode.Strict,
            Secure = isProduction,
            Path = "/",
        });
    }

    private static void DeleteCsrfCookie(IResponseCookies cookies, bool isProduction)
    {
        cookies.Delete(AuthConstants.CsrfCookieName, new CookieOptions
        {
            HttpOnly = false,
            SameSite = SameSiteMode.Strict,
            Secure = isProduction,
            Path = "/",
        });
    }

    public sealed record LoginRequest(string Username, string Password);

    public sealed record AccessCodeRequest(string? Email);

    public sealed record VerifyCodeRequest(string? Email, string? Code);

    public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

    public sealed record LoginResponse(CurrentUser User, DateTimeOffset ExpiresAtUtc);
}
