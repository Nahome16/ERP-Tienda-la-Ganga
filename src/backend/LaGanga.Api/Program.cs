using System.Security.Claims;
using System.Threading.RateLimiting;
using LaGanga.Api.Identity;
using LaGanga.Application;
using LaGanga.Application.Identity;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure;
using LaGanga.Infrastructure.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var authenticationSettings = builder.Configuration
    .GetSection(AuthenticationSettings.SectionName)
    .Get<AuthenticationSettings>() ?? new AuthenticationSettings();
builder.Services.AddSingleton(authenticationSettings);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<AuthService>();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHealthChecks();
builder.Services.AddProblemDetails();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(AuthConstants.LoginRateLimitPolicy, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 5,
                QueueLimit = 0,
                Window = TimeSpan.FromMinutes(1),
            }));
});
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = AuthConstants.AccessCookieName;
        options.Cookie.HttpOnly = true;
        options.Cookie.IsEssential = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = builder.Environment.IsProduction()
            ? CookieSecurePolicy.Always
            : CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = authenticationSettings.MaximumSessionDuration;
        options.SlidingExpiration = false;
        options.Events = new CookieAuthenticationEvents
        {
            OnValidatePrincipal = async context =>
            {
                var sessionValue = context.Principal?.FindFirstValue(AuthConstants.SessionIdClaim);
                if (!Guid.TryParse(sessionValue, out var sessionId))
                {
                    context.RejectPrincipal();
                    return;
                }

                var authService = context.HttpContext.RequestServices.GetRequiredService<AuthService>();
                var user = await authService.ValidateSessionAsync(
                    sessionId,
                    context.HttpContext.RequestAborted);
                if (user is null || context.Principal?.Identity is not ClaimsIdentity identity)
                {
                    context.RejectPrincipal();
                    return;
                }

                foreach (var claim in identity.FindAll(ClaimTypes.Role).ToArray())
                {
                    identity.RemoveClaim(claim);
                }

                foreach (var claim in identity.FindAll(AuthConstants.PermissionClaim).ToArray())
                {
                    identity.RemoveClaim(claim);
                }

                identity.AddClaims(user.Roles.Select(role => new Claim(ClaimTypes.Role, role)));
                identity.AddClaims(user.Permissions.Select(
                    permission => new Claim(AuthConstants.PermissionClaim, permission)));
            },
            OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            },
            OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AuthConstants.InventoryCostPolicy, policy =>
        policy.RequireClaim(AuthConstants.PermissionClaim, PermissionNames.InventoryCostRead));

var app = builder.Build();

if (args.Contains("--bootstrap-admin", StringComparer.OrdinalIgnoreCase))
{
    await BootstrapAdministratorAsync(app.Services);
    return;
}

app.UseExceptionHandler();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () =>
    Results.Ok(SystemStatus.Healthy(TimeProvider.System.GetUtcNow())))
    .WithName("GetSystemStatus");

app.MapHealthChecks("/health");
app.MapAuthenticationEndpoints();

app.Run();

static async Task BootstrapAdministratorAsync(IServiceProvider services)
{
    var username = Environment.GetEnvironmentVariable("LA_GANGA_ADMIN_USERNAME");
    var displayName = Environment.GetEnvironmentVariable("LA_GANGA_ADMIN_DISPLAY_NAME");
    var password = Environment.GetEnvironmentVariable("LA_GANGA_ADMIN_PASSWORD");

    if (string.IsNullOrWhiteSpace(username) ||
        string.IsNullOrWhiteSpace(displayName) ||
        string.IsNullOrWhiteSpace(password) ||
        password.Length < 12)
    {
        throw new InvalidOperationException(
            "Set LA_GANGA_ADMIN_USERNAME, LA_GANGA_ADMIN_DISPLAY_NAME and a password of at least 12 characters before bootstrapping.");
    }

    await using var scope = services.CreateAsyncScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<LaGangaDbContext>();
    await dbContext.Database.MigrateAsync();
    var bootstrapper = scope.ServiceProvider.GetRequiredService<IdentityBootstrapper>();
    var created = await bootstrapper.CreateInitialAdministratorAsync(
        username,
        displayName,
        password,
        CancellationToken.None);

    Console.WriteLine(created
        ? "Initial administrator created. Remove the bootstrap environment variables now."
        : "Bootstrap skipped because at least one user already exists.");
}

public partial class Program;
