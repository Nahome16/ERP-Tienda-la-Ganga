using LaGanga.Domain.Inventory;

namespace LaGanga.Domain.Tests;

public sealed class Ean13Tests
{
    [Theory]
    [InlineData("400638133393", '1')]
    [InlineData("590123412345", '7')]
    [InlineData("036000291452", '2')]
    public void CheckDigitMatchesKnownCodes(string body, char expected) =>
        Assert.Equal(expected, Ean13.CheckDigit(body));

    [Fact]
    public void InternalCodesAreValidThirteenDigitCodesStartingWithTwenty()
    {
        var first = Ean13.FromSequence(1);
        var second = Ean13.FromSequence(2);

        Assert.Equal(13, first.Length);
        Assert.StartsWith("20", first, StringComparison.Ordinal);
        Assert.True(Ean13.IsValid(first));
        Assert.True(Ean13.IsValid(second));
        Assert.NotEqual(first, second);
        Assert.False(Ean13.IsValid("2000000000001"));
    }

    [Fact]
    public void SequenceOutOfRangeIsRejected() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => Ean13.FromSequence(0));
}
