using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

// Workaround from https://github.com/Azure/azure-functions-dotnet-worker/issues/3374#issuecomment-4984606378
Directory.SetCurrentDirectory(AppContext.BaseDirectory);

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

var useSqlite = builder.Services.AddSessionAppDbContext();

builder.Services.AddSingleton<SetAnalyzer>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<TheSessionImportService>();

var app = builder.Build();

DbSetup.InitializeDatabase(app.Services, useSqlite);

// One-time SQL -> Cosmos data copy, triggered by the RunMigrationOnStartup app setting. Lives here
// (not behind an HTTP endpoint) so it works even when the app sits behind EasyAuth/WAF. No-op unless
// the flag is set; never throws. Remove the app setting once the copy is confirmed.
await SqlToCosmosMigrator.RunIfRequestedAsync();

app.Run();
