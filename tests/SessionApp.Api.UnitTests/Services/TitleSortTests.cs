using System.Linq;
using SessionApp.Api.Services;
using Xunit;

namespace SessionApp.Api.UnitTests.Services;

/// <summary>
/// Tune and set names file under their first real word, the way a musician looks them up in a tune
/// book. The rule used to be copy-pasted at each call site, so these pin it in one place.
/// </summary>
public class TitleSortTests
{
    [Theory]
    [InlineData("The Kesh", "Kesh")]
    [InlineData("the kesh", "kesh")]
    [InlineData("A Fig for a Kiss", "Fig for a Kiss")]
    public void Key_DropsALeadingArticle(string title, string expected)
    {
        Assert.Equal(expected, TitleSort.Key(title));
    }

    [Theory]
    [InlineData("Theme from Ballydesmond")]   // "The" is only the start of a longer word
    [InlineData("Apples in Winter")]          // so is "A"
    [InlineData("Out on the Ocean")]          // an article anywhere but the start
    [InlineData("Cooley's")]
    public void Key_LeavesEverythingElseAlone(string title)
    {
        Assert.Equal(title, TitleSort.Key(title));
    }

    [Fact]
    public void Key_TreatsAMissingTitleAsEmpty()
    {
        Assert.Equal(string.Empty, TitleSort.Key(null));
    }

    [Fact]
    public void ByTitle_FilesEachTitleUnderItsFirstRealWord()
    {
        string[] titles = ["The Kesh", "Apples in Winter", "Drowsy Maggie", "The Butterfly"];

        var sorted = titles.ByTitle(t => t).ToList();

        Assert.Equal(["Apples in Winter", "The Butterfly", "Drowsy Maggie", "The Kesh"], sorted);
    }

    [Fact]
    public void ByTitle_IgnoresCase()
    {
        string[] titles = ["the kesh", "Butterfly"];

        Assert.Equal(["Butterfly", "the kesh"], titles.ByTitle(t => t).ToList());
    }
}
