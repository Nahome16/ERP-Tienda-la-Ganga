using LaGanga.Application;

namespace LaGanga.Domain.Tests;

public sealed class SystemStatusTests
{
    [Fact]
    public void HealthyUsesTheBusinessTimeZoneAndProvidedTimestamp()
    {
        var timestamp = new DateTimeOffset(2026, 11, 6, 16, 30, 0, TimeSpan.Zero);

        var result = SystemStatus.Healthy(timestamp);

        Assert.Equal("La Ganga ERP API", result.Service);
        Assert.Equal("healthy", result.Status);
        Assert.Equal("America/Managua", result.TimeZone);
        Assert.Equal(timestamp, result.CheckedAtUtc);
    }
}
