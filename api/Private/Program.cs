using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

using SessionApp.Api.Functions;

// Workaround from https://github.com/Azure/azure-functions-dotnet-worker/issues/3374#issuecomment-4984606378
Directory.SetCurrentDirectory(AppContext.BaseDirectory);
var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();
builder.UseMiddleware<ModeratorAuthorizationMiddleware>();


var useSqlite = builder.Services.AddSessionAppDbContext();

builder.Services.AddSingleton<SetAnalyzer>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<TheSessionImportService>();
builder.Services.AddScoped<GamificationService>();

var app = builder.Build();

DbSetup.InitializeDatabase(app.Services, useSqlite);

app.Run();
