using System.Security.Claims;
using System.Threading.RateLimiting;
using LaGanga.Api.Catalog;
using System.Text.Json.Serialization;
using LaGanga.Api.Identity;
using LaGanga.Api.Mvp;
using LaGanga.Api.Users;
using LaGanga.Application;
using LaGanga.Application.Identity;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure;
using LaGanga.Infrastructure.Catalog;
using LaGanga.Infrastructure.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.HttpOverrides;
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
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    // La API solo recibe tráfico a través del proxy inverso (Caddy), no directamente.
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});
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
                PermitLimit = builder.Configuration.GetValue("Authentication:LoginAttemptsPerMinute", 5),
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
                foreach (var claim in identity.FindAll(AuthenticationEndpoints.MustChangePasswordClaim).ToArray())
                {
                    identity.RemoveClaim(claim);
                }
                identity.AddClaim(new Claim(
                    AuthenticationEndpoints.MustChangePasswordClaim,
                    user.MustChangePassword.ToString()));
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
var authorization = builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AuthConstants.InventoryCostPolicy, policy =>
        policy.RequireClaim(AuthConstants.PermissionClaim, PermissionNames.InventoryCostRead));

authorization.AddPolicy(MvpPolicies.SettingsRead, policy => policy.RequireAssertion(context =>
    HasAnyPermission(context.User, PermissionNames.SaleCreate, PermissionNames.SettingsManage)));
authorization.AddPolicy(MvpPolicies.CashView, policy => policy.RequireAssertion(context =>
    HasAnyPermission(context.User, PermissionNames.CashOperate, PermissionNames.CashReportRead)));
authorization.AddPolicy(MvpPolicies.SaleView, policy => policy.RequireAssertion(context =>
    HasAnyPermission(context.User, PermissionNames.SaleCreate, PermissionNames.SaleRead, PermissionNames.CashReportRead)));

// Una política por permiso, con el mismo nombre: RequireAuthorization("catalog.read").
foreach (var permission in PermissionNames.All)
{
    authorization.AddPolicy(permission, policy =>
        policy.RequireClaim(AuthConstants.PermissionClaim, permission));
}

var app = builder.Build();

if (app.Configuration.GetValue("Database:AutoMigrate", false))
{
    // Despliegue: aplica migraciones y sincroniza roles y permisos al arrancar.
    await SynchronizeRolesAsync(app.Services);
}

if (args.Contains("--bootstrap-admin", StringComparer.OrdinalIgnoreCase))
{
    await BootstrapAdministratorAsync(app.Services);
    return;
}

if (args.Contains("--sync-roles", StringComparer.OrdinalIgnoreCase))
{
    await SynchronizeRolesAsync(app.Services);
    return;
}

if (args.Contains("--seed-catalogs", StringComparer.OrdinalIgnoreCase))
{
    await SynchronizeRolesAsync(app.Services);
    await SeedCatalogsAsync(app.Services, null);
    return;
}

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseRateLimiter();
app.UseAuthentication();
app.Use(async (context, next) =>
{
    var mustChangePassword = context.User.Identity?.IsAuthenticated == true &&
        string.Equals(
            context.User.FindFirstValue(AuthenticationEndpoints.MustChangePasswordClaim),
            bool.TrueString,
            StringComparison.OrdinalIgnoreCase);
    var allowedDuringPasswordChange = context.Request.Path.StartsWithSegments("/api/v1/auth/me") ||
        context.Request.Path.StartsWithSegments("/api/v1/auth/password") ||
        context.Request.Path.StartsWithSegments("/api/v1/auth/logout");
    if (mustChangePassword && context.Request.Path.StartsWithSegments("/api/v1") && !allowedDuringPasswordChange)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await Results.Problem(
            statusCode: StatusCodes.Status403Forbidden,
            title: "Debés crear una contraseña nueva antes de continuar.",
            extensions: new Dictionary<string, object?> { ["code"] = "password_change_required" })
            .ExecuteAsync(context);
        return;
    }

    await next();
});
app.UseAuthorization();

app.MapGet("/api/health", () =>
    Results.Ok(SystemStatus.Healthy(TimeProvider.System.GetUtcNow())))
    .WithName("GetSystemStatus");

app.MapHealthChecks("/health");
app.MapAuthenticationEndpoints();
app.MapCatalogEndpoints();
app.MapUserEndpoints();
app.MapMvpEndpoints();

app.Run();

static bool HasAnyPermission(ClaimsPrincipal user, params string[] permissions) =>
    permissions.Any(permission => user.HasClaim(AuthConstants.PermissionClaim, permission));

static async Task BootstrapAdministratorAsync(IServiceProvider services)
{
    var username = Environment.GetEnvironmentVariable("LA_GANGA_ADMIN_USERNAME");
    var displayName = Environment.GetEnvironmentVariable("LA_GANGA_ADMIN_DISPLAY_NAME");
    var email = Environment.GetEnvironmentVariable("LA_GANGA_ADMIN_EMAIL");
    var password = Environment.GetEnvironmentVariable("LA_GANGA_ADMIN_PASSWORD");

    if (string.IsNullOrWhiteSpace(username) ||
        string.IsNullOrWhiteSpace(displayName) ||
        (string.IsNullOrWhiteSpace(email) && (string.IsNullOrWhiteSpace(password) || password.Length < 12)))
    {
        throw new InvalidOperationException(
            "Set LA_GANGA_ADMIN_USERNAME, LA_GANGA_ADMIN_DISPLAY_NAME and LA_GANGA_ADMIN_EMAIL for verified access, " +
            "or LA_GANGA_ADMIN_PASSWORD (12+ characters) for the legacy bootstrap.");
    }

    await using var scope = services.CreateAsyncScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<LaGangaDbContext>();
    await dbContext.Database.MigrateAsync();
    var bootstrapper = scope.ServiceProvider.GetRequiredService<IdentityBootstrapper>();
    var created = string.IsNullOrWhiteSpace(email)
        ? await bootstrapper.CreateInitialAdministratorAsync(
            username,
            displayName,
            password!,
            CancellationToken.None)
        : await bootstrapper.CreateInitialAdministratorInvitationAsync(
            username,
            displayName,
            email,
            CancellationToken.None);

    if (created && !string.IsNullOrWhiteSpace(email))
    {
        await scope.ServiceProvider.GetRequiredService<IAccountAccessService>()
            .RequestCodeAsync(email, CancellationToken.None);
    }

    Console.WriteLine(created
        ? string.IsNullOrWhiteSpace(email)
            ? "Initial administrator created. Remove the bootstrap environment variables now."
            : "Initial administrator created and verification code requested by email. Remove the bootstrap environment variables now."
        : "Bootstrap skipped because at least one user already exists.");

    if (created)
    {
        var normalizedUsername = UserAccount.NormalizeUsername(username);
        var administratorId = await dbContext.Users
            .Where(user => user.NormalizedUsername == normalizedUsername)
            .Select(user => user.Id)
            .SingleAsync();
        await SeedCatalogsAsync(services, administratorId);
    }
}

static async Task SynchronizeRolesAsync(IServiceProvider services)
{
    await using var scope = services.CreateAsyncScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<LaGangaDbContext>();
    await dbContext.Database.MigrateAsync();
    var synchronizer = scope.ServiceProvider.GetRequiredService<RoleSynchronizer>();
    var changes = await synchronizer.SynchronizeAsync(CancellationToken.None);
    Console.WriteLine(changes > 0
        ? $"Roles and permissions synchronized: {changes} changes."
        : "Roles and permissions were already up to date.");
}

static async Task SeedCatalogsAsync(IServiceProvider services, Guid? createdBy)
{
    await using var scope = services.CreateAsyncScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<LaGangaDbContext>();
    await dbContext.Database.MigrateAsync();
    var seeder = scope.ServiceProvider.GetRequiredService<CatalogSeeder>();
    var inserted = await seeder.SeedAsync(createdBy, CancellationToken.None);
    Console.WriteLine(inserted > 0
        ? $"Catalogs seeded: {inserted} rows inserted."
        : "Catalog seed skipped because the catalogs already have data.");
}

public partial class Program;
