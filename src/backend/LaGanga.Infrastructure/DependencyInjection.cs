using LaGanga.Application.Catalog;
using LaGanga.Application.Identity;
using LaGanga.Application.Users;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Catalog;
using LaGanga.Infrastructure.Identity;
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
        services.AddScoped<IdentityBootstrapper>();
        services.AddScoped<RoleSynchronizer>();
        services.AddScoped<IUserAdminService, UserAdminService>();
        services.AddScoped<ICatalogService, CatalogService>();
        services.AddScoped<CatalogSeeder>();
        return services;
    }
}
