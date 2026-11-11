using LaGanga.Domain.Sales;

namespace LaGanga.Domain.Tests;

public sealed class ExchangePolicyTests
{
    private static readonly DateOnly Monday = new(2026, 11, 9);

    [Theory]
    [InlineData(0, true)]
    [InlineData(1, true)]
    [InlineData(4, true)]
    [InlineData(5, false)]
    [InlineData(-1, false)]
    public void FourDayWindowCountsCalendarDays(int daysLater, bool allowed)
    {
        Assert.Equal(allowed, ExchangePolicy.IsWithinWindow(Monday, Monday.AddDays(daysLater), 4));
    }

    [Fact]
    public void ZeroDayWindowAllowsOnlyTheSameDay()
    {
        Assert.True(ExchangePolicy.IsWithinWindow(Monday, Monday, 0));
        Assert.False(ExchangePolicy.IsWithinWindow(Monday, Monday.AddDays(1), 0));
    }

    [Fact]
    public void DaysSinceIsTheCalendarDifference()
    {
        Assert.Equal(4, ExchangePolicy.DaysSince(Monday, new DateOnly(2026, 11, 13)));
    }
}
