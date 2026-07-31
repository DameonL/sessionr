# EF Core migrations

Schema management:

- **Production (Azure SQL / SqlServer):** driven by these EF Core migrations, applied at
  startup by `DbSetup.InitializeDatabase` → `db.Database.Migrate()`.
- **Local dev (SQLite):** the disposable dev file is built directly from the model via
  `EnsureCreated()` + seed (`DbInitializer.InitializeDevDatabase`). Migrations are **not**
  used for SQLite — do not run `dotnet ef` against it.

## Adding a migration

```
cd api/Shared
dotnet ef migrations add <Name>
```

The design-time factory (`AppDbContextDesignTimeFactory`) hardwires the SqlServer provider,
so migrations are always SqlServer-flavored. Review the generated SQL before merging.

## ⚠️ Baseline drift: read before writing your first migration

`InitialCreate` was generated from the current model, **not** reverse-engineered from the
live production database. Production predates EF migrations — it was built by `EnsureCreated`
plus a hand-written migrator (the deleted `DbSchemaMigrator.cs`), so several objects in prod
have names/shapes that differ from what this `InitialCreate` snapshot records.

On the migrations cutover deploy this is harmless: `InitialCreate` is baselined as
already-applied (see `DbSetup.BaselineExistingSchema`), so nothing runs against these tables.
The risk is the **next** migration: `dotnet ef` diffs against the snapshot, so a change that
touches a drifted object can emit SQL referencing a name/shape that doesn't exist in prod and
fail. **Hand-check the generated SQL of the first real migration against prod** for anything
in the table below.

| Object | Actual production (old migrator) | Snapshot / model |
|---|---|---|
| `PointsTransactions` FK | `FK_PointsTransactions_Users` | `FK_PointsTransactions_Users_UserId` |
| `PointsTransactions` uniqueness | `UQ_PointsTransactions_User_Reason_Source` UNIQUE constraint (all rows) | filtered unique index `IX_PointsTransactions_UserId_Reason_SourceId` (`WHERE [SourceId] IS NOT NULL`) |
| `Friendships` FKs | `FK_Friendships_Requester`, `FK_Friendships_Receiver`; receiver has **no** cascade | `FK_Friendships_Users_RequesterId`, `FK_Friendships_Users_ReceiverId`; both cascade |
| `Users.Location` / `Users.Instruments` | `NVARCHAR(256)` / `NVARCHAR(512)` | `nvarchar(max)` |
| `GroupSessions.Location` | `NVARCHAR(200)` | `nvarchar(max)` |
| Various columns (`RepertoireCount`, `IsReviewed`, `CreatedAt`, streak, …) | added with SQL `DEFAULT` constraints | no DB-level default |

The other four migrator-built tables (`UserBadges`, `GroupSessions`, `SessionRsvps`, and the
`PointsTransactions`/`Friendships` above) were created with hand-written constraint names, so
assume any FK/unique/PK name on those five tables may differ from EF conventions in prod.
