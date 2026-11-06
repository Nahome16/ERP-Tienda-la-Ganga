namespace LaGanga.Api.Tests;

public sealed class ApiAssemblyTests
{
    [Fact]
    public void ApiEntryPointIsAvailableToTheTestHost()
    {
        Assert.Equal("LaGanga.Api", typeof(Program).Assembly.GetName().Name);
    }
}
