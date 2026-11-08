using LaGanga.Domain.Catalog;

namespace LaGanga.Domain.Tests;

public sealed class CatalogTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 8, 18, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("  azul   OSCURO ", "AZUL OSCURO")]
    [InlineData("Azul oscuro", "AZUL OSCURO")]
    [InlineData("Levi’s", "LEVI’S")]
    public void NormalizationIgnoresExtraSpacesAndLetterCase(string input, string expected)
    {
        Assert.Equal(expected, CatalogText.Normalize(input));
    }

    [Fact]
    public void VisibleNameKeepsChosenCaseButCollapsesSpaces()
    {
        var brand = new Brand(Guid.NewGuid(), "  Zolo   Jeans ", 10, null, Now);

        Assert.Equal("Zolo Jeans", brand.Name);
        Assert.Equal("ZOLO JEANS", brand.NormalizedName);
    }

    [Fact]
    public void XlAndOneXlAreDifferentSizes()
    {
        Assert.NotEqual(CatalogText.Normalize("XL"), CatalogText.Normalize("1XL"));
    }

    [Fact]
    public void EmptyNameIsRejected()
    {
        var exception = Assert.Throws<CatalogRuleException>(
            () => new Cut(Guid.NewGuid(), "   ", 10, null, Now));

        Assert.Equal("name_required", exception.Code);
    }

    [Fact]
    public void NegativeSortOrderIsRejected()
    {
        var exception = Assert.Throws<CatalogRuleException>(
            () => new Brand(Guid.NewGuid(), "Kalua", -1, null, Now));

        Assert.Equal("invalid_sort_order", exception.Code);
    }

    [Theory]
    [InlineData("#183b56", "#183B56")]
    [InlineData(" #FFFFFF ", "#FFFFFF")]
    [InlineData(null, null)]
    [InlineData("", null)]
    public void SwatchIsNormalizedOrOmitted(string? input, string? expected)
    {
        Assert.Equal(expected, Color.NormalizeSwatch(input));
    }

    [Theory]
    [InlineData("183B56")]
    [InlineData("#18 B56")]
    [InlineData("#GGGGGG")]
    [InlineData("#1234567")]
    public void InvalidSwatchIsRejected(string input)
    {
        var exception = Assert.Throws<CatalogRuleException>(() => Color.NormalizeSwatch(input));

        Assert.Equal("invalid_swatch", exception.Code);
    }

    [Fact]
    public void CategoryCannotBeItsOwnParent()
    {
        var id = Guid.NewGuid();

        var exception = Assert.Throws<CatalogRuleException>(
            () => new Category(id, "Dama", id, 10, null, Now));

        Assert.Equal("category_cycle", exception.Code);
    }

    [Fact]
    public void MovingCategoryUnderItsDescendantIsACycle()
    {
        var dama = Guid.NewGuid();
        var pantalones = Guid.NewGuid();
        var palazzo = Guid.NewGuid();
        var parents = new Dictionary<Guid, Guid?>
        {
            [dama] = null,
            [pantalones] = dama,
            [palazzo] = pantalones,
        };

        Assert.True(CategoryHierarchy.WouldCreateCycle(dama, palazzo, parents));
        Assert.False(CategoryHierarchy.WouldCreateCycle(palazzo, dama, parents));
        Assert.False(CategoryHierarchy.WouldCreateCycle(pantalones, null, parents));
    }

    [Fact]
    public void InactivatingTwiceKeepsTheSameState()
    {
        var color = new Color(Guid.NewGuid(), "Negro", null, 10, null, Now);

        color.Inactivate(null, Now.AddMinutes(1));
        color.Inactivate(null, Now.AddMinutes(2));

        Assert.False(color.IsActive);
        Assert.Equal(Now.AddMinutes(1), color.UpdatedAtUtc);
    }
}
