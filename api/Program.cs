using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

// Azure SQL in production; a local SQLite file when no connection string is
// configured so the app is fully runnable without provisioning a database.
var sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString");
var useSqlite = string.IsNullOrWhiteSpace(sqlConnectionString);

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (useSqlite)
    {
        options.UseSqlite("Data Source=sessionapp.dev.db");
    }
    else
    {
        options.UseSqlServer(sqlConnectionString);
    }
});

builder.Services.AddSingleton<SetAnalyzer>();
builder.Services.AddHttpClient();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    try
    {
        db.Database.ExecuteSqlRaw("ALTER TABLE Tunes ADD TheSessionId INT NULL;");
    }
    catch { }
}

if (useSqlite)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    DbInitializer.InitializeDevDatabase(db);
}

app.Run();
