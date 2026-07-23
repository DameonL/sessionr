using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

var useSqlite = builder.Services.AddSessionAppDbContext();

builder.Services.AddSingleton<SetAnalyzer>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<TheSessionImportService>();
builder.Services.AddScoped<GamificationService>();

var app = builder.Build();

DbSetup.InitializeDatabase(app.Services, useSqlite);

app.Run();
