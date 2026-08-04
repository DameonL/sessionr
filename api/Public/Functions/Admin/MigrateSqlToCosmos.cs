using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;

namespace SessionApp.Api.Functions.Admin;

/// <summary>
/// One-time public data copy from the legacy Azure SQL database into Azure Cosmos DB for NoSQL.
/// Lives on the PUBLIC app on purpose: the Private app sits behind EasyAuth, which no one can pass
/// until Cosmos has user records, so a private endpoint would be unreachable during the very migration
/// that seeds it. Anonymous and idempotent (re-running only copies rows the target is still missing),
/// so it is safe to trigger from a public button. Remove once the copy is confirmed.
/// </summary>
public class MigrateSqlToCosmos
{
    [Function("MigrateSqlToCosmos")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "migrate-sql-to-cosmos")] HttpRequest req)
    {
        var sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString");
        var cosmosConnectionString = Environment.GetEnvironmentVariable("CosmosConnectionString")
            ?? Environment.GetEnvironmentVariable("MongoConnectionString");

        if (string.IsNullOrWhiteSpace(sqlConnectionString))
        {
            return new BadRequestObjectResult(new { error = "SqlConnectionString environment variable is required as the source database connection (set it on the Public Function App)." });
        }

        if (string.IsNullOrWhiteSpace(cosmosConnectionString))
        {
            return new BadRequestObjectResult(new { error = "CosmosConnectionString environment variable is required as the target database connection." });
        }

        var dbName = Environment.GetEnvironmentVariable("CosmosDatabaseName") ?? "sessionr";

        var counts = await SqlToCosmosMigrator.RunAsync(sqlConnectionString, cosmosConnectionString, dbName);

        return new OkObjectResult(new
        {
            success = true,
            message = "Migration from Azure SQL to Cosmos DB for NoSQL completed successfully.",
            counts
        });
    }
}
