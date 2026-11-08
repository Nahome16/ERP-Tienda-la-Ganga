using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace LaGanga.Infrastructure.Persistence;

public sealed class LaGangaDbContextFactory : IDesignTimeDbContextFactory<LaGangaDbContext>
{
    public LaGangaDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable(
            "ConnectionStrings__DefaultConnection") ??
            "Host=localhost;Database=la_ganga_dev;Username=la_ganga";
        var options = new DbContextOptionsBuilder<LaGangaDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new LaGangaDbContext(options);
    }
}
