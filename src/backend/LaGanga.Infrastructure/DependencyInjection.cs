using LaGanga.Application.Catalog;
using LaGanga.Application.Common;
using LaGanga.Application.Identity;
using LaGanga.Application.Investment;
using LaGanga.Application.Inventory;
using LaGanga.Application.Sales;
using LaGanga.Application.Settings;
using LaGanga.Application.Users;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Catalog;
using LaGanga.Infrastructure.Identity;
using LaGanga.Infrastructure.Inventory;
using LaGanga.Infrastructure.Reports;
using LaGanga.Infrastructure.Sales;
using LaGanga.Infrastructure.Settings;
using LaGanga.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LaGanga.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection") ??
            throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection must be configured outside source control.");

        services.AddDbContext<LaGangaDbContext>(options => options.UseNpgsql(connectionString));
        services.AddScoped<IIdentityStore, IdentityStore>();
        services.AddScoped<IPasswordHasher<UserAccount>, PasswordHasher<UserAccount>>();
        services.AddScoped<IPasswordService, PasswordService>();
        services.AddSingleton(configuration.GetSection(AccessCodeSettings.SectionName).Get<AccessCodeSettings>() ?? new AccessCodeSettings());
        services.AddSingleton(configuration.GetSection(EmailSettings.SectionName).Get<EmailSettings>() ?? new EmailSettings());
        services.AddScoped<IEmailSender, SmtpEmailSender>();
        services.AddScoped<IAccountAccessService, AccountAccessService>();
        services.AddScoped<IdentityBootstrapper>();
        services.AddScoped<RoleSynchronizer>();
        services.AddScoped<IUserAdminService, UserAdminService>();
        services.AddScoped<ICatalogService, CatalogService>();
        services.AddScoped<CatalogSeeder>();
        services.AddScoped<IAuditWriter, AuditWriter>();
        services.AddScoped<IAuditQueryService, AuditQueryService>();
        services.AddScoped<ISettingsService, SettingsService>();
        services.AddScoped<IProductService, ProductService>();
        services.AddScoped<IInvestmentService, InvestmentService>();
        services.AddScoped<IInventoryService, InventoryService>();
        services.AddScoped<ILabelService, LabelService>();
        services.AddSingleton<IImageStorage, LocalImageStorage>();
        services.AddScoped<IProductImageService, ProductImageService>();
        services.AddScoped<IPosService, PosService>();
        services.AddScoped<ICashService, CashService>();
        services.AddScoped<ISalesService, SalesService>();
        services.AddScoped<IExchangeService, ExchangeService>();
        services.AddScoped<ISupervisorVerifier, SupervisorVerifier>();
        services.AddScoped<IPosVoidService, PosVoidService>();
        services.AddScoped<IReportService, ReportService>();
        return services;
    }
}
