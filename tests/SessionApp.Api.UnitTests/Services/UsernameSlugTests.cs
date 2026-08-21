using SessionApp.Api.Services;

namespace SessionApp.Api.UnitTests.Services;

public class UsernameSlugTests
{
    [Theory]
    [InlineData("Dev Musician", "dev-musician")]
    [InlineData("  Padded Name  ", "padded-name")]
    [InlineData("MiXeD CaSe", "mixed-case")]
    [InlineData("O'Carolan's Draught", "o-carolan-s-draught")]
    [InlineData("Séan --- Ryan", "s-an-ryan")]
    [InlineData("---leading and trailing---", "leading-and-trailing")]
    public void Slugify_ProducesCanonicalSlug(string displayName, string expected)
    {
        Assert.Equal(expected, UsernameSlug.Slugify(displayName));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("!!!")]      // nothing usable survives
    [InlineData("ab")]       // shorter than the 3-char minimum
    [InlineData("é")]        // non-ASCII strips to nothing
    public void Slugify_ReturnsNullWhenNothingUsableSurvives(string? displayName)
    {
        Assert.Null(UsernameSlug.Slugify(displayName));
    }

    [Fact]
    public void Slugify_TruncatesToThirtyCharacters()
    {
        var slug = UsernameSlug.Slugify(new string('a', 50));

        Assert.NotNull(slug);
        Assert.Equal(30, slug!.Length);
    }

    [Fact]
    public void Slugify_DoesNotLeaveATrailingDashAfterTruncation()
    {
        // 29 chars, then a space: truncating at 30 would otherwise leave "...-".
        var slug = UsernameSlug.Slugify(new string('a', 29) + " tail");

        Assert.NotNull(slug);
        Assert.DoesNotContain("-", slug!.AsSpan()[^1..].ToString());
        Assert.Equal(29, slug.Length);
    }

    [Fact]
    public void Slugify_OutputAlwaysSatisfiesValidFormat()
    {
        string[] names = ["Dev Musician", "O'Carolan's Draught", new string('a', 50), "The  Session   Player"];

        foreach (var name in names)
        {
            var slug = UsernameSlug.Slugify(name);
            Assert.NotNull(slug);
            Assert.Matches(UsernameSlug.ValidFormat, slug!);
        }
    }

    [Theory]
    [InlineData("abc", true)]
    [InlineData("dev-musician", true)]
    [InlineData("ab", false)]           // too short
    [InlineData("Dev-Musician", false)] // uppercase
    [InlineData("dev musician", false)] // space
    [InlineData("dev_musician", false)] // underscore
    public void ValidFormat_MatchesOnlyCanonicalSlugs(string candidate, bool expected)
    {
        Assert.Equal(expected, UsernameSlug.ValidFormat.IsMatch(candidate));
    }
}
