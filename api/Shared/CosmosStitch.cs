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

    /// <summary>
    /// Cosmos-safe existence check. The Cosmos provider translates <c>AnyAsync(predicate)</c> to an
    /// EXISTS form emitted with an unresolved <c>root</c> identifier, which Cosmos rejects with
    /// <c>SC2001 BadRequest</c> ("Identifier 'root' could not be resolved") — so filter with
    /// <c>.Where(...)</c> and call this instead, which uses a LIMIT-1 read that translates cleanly.
    /// </summary>
    public static async Task<bool> CosmosAnyAsync<T>(this IQueryable<T> query)
        => (await query.Take(1).ToListAsync()).Count > 0;

    /// <summary>
    /// Cosmos-safe count. <c>CountAsync(predicate)</c> hits the same <c>SC2001</c> <c>root</c>
    /// translation failure as <see cref="CosmosAnyAsync{T}"/>; project to a lightweight scalar with
    /// <c>.Select(...)</c> before calling this so the whole entity isn't materialized just to count.
    /// </summary>
    public static async Task<int> CosmosCountAsync<T>(this IQueryable<T> query)
        => (await query.ToListAsync()).Count;
}
