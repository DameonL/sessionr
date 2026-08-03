using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace SessionApp.Api.Functions;

/// <summary>
/// Helpers for the "load flat, then join in memory" pattern that replaces cross-document
/// <c>.Include(...)</c> on Cosmos. The Cosmos model severs relationships between separate documents
/// (see <c>AppDbContext.ConfigureCosmosContainers</c>), so related roots are fetched by id in a
/// second query and the entities' (now-unmapped) navigation properties are assigned by hand. The
/// same code runs unchanged on the SQLite dev provider.
/// </summary>
public static class CosmosStitch
{
    /// <summary>Materializes a filtered query and keys it by id for O(1) stitch lookups.</summary>
    public static async Task<Dictionary<Guid, T>> ToDictionaryByIdAsync<T>(
        this IQueryable<T> query, Func<T, Guid> keySelector)
        => (await query.ToListAsync()).ToDictionary(keySelector);
}
