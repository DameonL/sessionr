namespace SessionApp.Api.Data;

/// <summary>
/// One-off database migration hook, run idempotently at startup by both the
/// Public and Private Functions apps (see DbSetup.InitializeDatabase). All
/// prior migrations have been fully applied to production and dev — this is
/// currently a no-op, kept as the place to add the next schema/data fixup.
/// </summary>
public static class DbSchemaMigrator
{
    public static void EnsureSchemaUpToDate(AppDbContext db, bool useSqlite)
    {
    }
}
