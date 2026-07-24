using System.Text.RegularExpressions;

namespace SessionApp.Api.Services;

/// <summary>
/// Canonical username slug rules, shared by the DB backfill migration and the
/// live new-user auto-assignment path so both agree on exactly the same format.
/// </summary>
public static class UsernameSlug
{
    private static readonly Regex NonSlugChars = new(@"[^a-z0-9]+", RegexOptions.Compiled);

    public static readonly Regex ValidFormat = new(@"^[a-z0-9-]{3,30}$", RegexOptions.Compiled);

    /// <summary>Best-effort slug derived from a display name. Returns null if nothing usable survives.</summary>
    public static string? Slugify(string? displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName)) return null;

        var lowered = displayName.Trim().ToLowerInvariant();
        var slug = NonSlugChars.Replace(lowered, "-").Trim('-');
        slug = Regex.Replace(slug, "-{2,}", "-");

        if (slug.Length < 3) return null;
        if (slug.Length > 30) slug = slug[..30].TrimEnd('-');

        return slug.Length < 3 ? null : slug;
    }
}
