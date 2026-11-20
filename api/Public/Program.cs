using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using SessionApp.Api.Services;

// Workaround from https://github.com/Azure/azure-functions-dotnet-worker/issues/3374#issuecomment-4984606378
Directory.SetCurrentDirectory(AppContext.BaseDirectory);

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();
builder.UseMiddleware<PublicHttpCachingMiddleware>();

var useSqlite = builder.Services.AddSessionAppDbContext();

builder.Services.AddSingleton<SetAnalyzer>();
builder.Services.AddSingleton<TuneHeuristics>();
builder.Services.AddSingleton<TuneMatchIndex>();
builder.Services.AddSingleton<TuneLibraryIndex>();
if (bool.TryParse(Environment.GetEnvironmentVariable("ENABLE_MATCH_INDEX_WARMUP"), out var warmMatchIndex) && warmMatchIndex)
{
    builder.Services.AddHostedService<MatchIndexWarmupService>();
}
builder.Services.AddHttpClient();
builder.Services.AddScoped<TheSessionImportService>();

var app = builder.Build();

DbSetup.InitializeDatabase(app.Services, useSqlite);

app.Run();

/// <summary>
/// Warms <see cref="TuneMatchIndex"/> asynchronously on host startup so the first
/// <c>/api/tunes/match</c> request does not have to pay the full cold Cosmos rebuild.
/// </summary>
file sealed class MatchIndexWarmupService(TuneMatchIndex matchIndex) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await matchIndex.WarmupAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal host shutdown.
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[MatchIndexWarmupService] Background warmup failed (will retry lazily on request):\n{ex}");
        }
    }
}
