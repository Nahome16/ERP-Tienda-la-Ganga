using LaGanga.Application.Identity;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Catalog;
using LaGanga.Infrastructure.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace LaGanga.Api.Tests;

/// <summary>
/// Prueba que solo se ejecuta cuando existe una base PostgreSQL disponible
/// en la variable LA_GANGA_TEST_CONNECTION (por ejemplo, en GitHub Actions).
/// </summary>
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(CatalogApiFixture.ConnectionVariable)))
        {
            Skip = $"Definí {CatalogApiFixture.ConnectionVariable} para ejecutar pruebas contra PostgreSQL.";
        }
    }
}

/// <summary>
/// Levanta la API completa sobre una base de datos nueva y temporal, con un
/// administrador (todos los permisos) y un lector (solo catalog.read).
/// </summary>
public sealed class CatalogApiFixture : IAsyncLifetime, IDisposable
{
    public const string ConnectionVariable = "LA_GANGA_TEST_CONNECTION";
    public const string AdminUsername = "admin.pruebas";
    public const string ReaderUsername = "lector.pruebas";
    private const string Password = "Contrasena-de-prueba-2026";

    private string? _serverConnection;
    private string? _databaseName;
    private WebApplicationFactory<Program>? _factory;

    public bool IsAvailable => _factory is not null;

    public HttpClient Admin { get; private set; } = null!;

    public string AdminCsrf { get; private set; } = string.Empty;

    public HttpClient Reader { get; private set; } = null!;

    public string ReaderCsrf { get; private set; } = string.Empty;

    public HttpClient Anonymous { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        _serverConnection = Environment.GetEnvironmentVariable(ConnectionVariable);
        if (string.IsNullOrWhiteSpace(_serverConnection))
        {
            return;
        }

        _databaseName = $"la_ganga_it_{Guid.NewGuid():N}";
        await ExecuteOnServerAsync($"CREATE DATABASE \"{_databaseName}\"");

        var testConnection = new NpgsqlConnectionStringBuilder(_serverConnection)
        {
            Database = _databaseName,
        }.ConnectionString;
        Environment.SetEnvironmentVariable("ConnectionStrings__DefaultConnection", testConnection);

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:DefaultConnection", testConnection);
        });

        await PrepareDatabaseAsync(_factory.Services);

        Admin = _factory.CreateClient();
        AdminCsrf = await ApiTestHelpers.LoginAsync(Admin, AdminUsername, Password);
        Reader = _factory.CreateClient();
        ReaderCsrf = await ApiTestHelpers.LoginAsync(Reader, ReaderUsername, Password);
        Anonymous = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        Dispose();
        if (_databaseName is not null)
        {
            NpgsqlConnection.ClearAllPools();
            await ExecuteOnServerAsync($"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)");
            _databaseName = null;
        }
    }

    public void Dispose()
    {
        if (_factory is not null)
        {
            Admin.Dispose();
            Reader.Dispose();
            Anonymous.Dispose();
            _factory.Dispose();
            _factory = null;
        }

        GC.SuppressFinalize(this);
    }

    private static async Task PrepareDatabaseAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        var dbContext = provider.GetRequiredService<LaGangaDbContext>();
        await dbContext.Database.MigrateAsync();

        var bootstrapper = provider.GetRequiredService<IdentityBootstrapper>();
        await bootstrapper.CreateInitialAdministratorAsync(
            AdminUsername,
            "Administración de pruebas",
            Password,
            CancellationToken.None);

        var catalogRead = await dbContext.Permissions
            .SingleAsync(permission => permission.Name == PermissionNames.CatalogRead);
        var readerRole = new Role(Guid.NewGuid(), "Lector de catálogos");
        readerRole.AddPermission(catalogRead);
        var reader = new UserAccount(Guid.NewGuid(), ReaderUsername, "Lector de pruebas", DateTimeOffset.UtcNow);
        reader.SetPasswordHash(provider.GetRequiredService<IPasswordService>().HashPassword(reader, Password));
        reader.AddRole(readerRole);
        dbContext.Roles.Add(readerRole);
        dbContext.Users.Add(reader);
        await dbContext.SaveChangesAsync();

        await provider.GetRequiredService<CatalogSeeder>().SeedAsync(null, CancellationToken.None);
    }

    private async Task ExecuteOnServerAsync(string commandText)
    {
        await using var connection = new NpgsqlConnection(_serverConnection);
        await connection.OpenAsync();
#pragma warning disable CA2100 // El nombre de la base es generado por la prueba, no proviene de usuarios.
        await using var command = new NpgsqlCommand(commandText, connection);
#pragma warning restore CA2100
        await command.ExecuteNonQueryAsync();
    }
}
