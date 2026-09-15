using System;
using System.Collections.Generic;
using System.Linq;

namespace SessionApp.Api.Services;

/// <summary>
/// How tune and set names sort: alphabetically, ignoring a leading article. "The Kesh" files under
/// K, the way a musician would look for it in a tune book, and a set named after its first tune
/// files the same way the tune does.
///
/// The rule was written inline at each call site, which meant the repertoire, the public profile
/// and the set lists could drift apart. It lives here so they cannot.
/// </summary>
public static class TitleSort
{
    /// <summary>The string to order by: the title with any leading article removed.</summary>
    public static string Key(string? title)
    {
        var value = title ?? string.Empty;

        if (value.StartsWith("The ", StringComparison.OrdinalIgnoreCase))
        {
            return value[4..];
        }
        if (value.StartsWith("A ", StringComparison.OrdinalIgnoreCase))
        {
            return value[2..];
        }

        return value;
    }

    /// <summary>
    /// Orders by title, articles ignored. Must run against materialized objects: Cosmos cannot
    /// translate the key, so callers sort after the query rather than inside it.
    /// </summary>
    public static IOrderedEnumerable<T> ByTitle<T>(this IEnumerable<T> source, Func<T, string?> title) =>
        source.OrderBy(item => Key(title(item)), StringComparer.OrdinalIgnoreCase);
}
