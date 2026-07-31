using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace SessionApp.Api.Data;

/// <summary>
/// Design-time factory used only by the EF Core tools (dotnet ef migrations add/script).
/// Migrations target the Azure SQL (SqlServer) production schema; the connection string
/// is a throwaway placeholder because the tools only need the model + provider, never a
/// live connection. The dev SQLite database is built from the model via EnsureCreated and
/// deliberately does not use migrations (see DbSetup / DbInitializer).
/// </summary>
public class AppDbContextDesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer("Server=(localdb)\\MSSQLLocalDB;Database=SessionAppDesign;Trusted_Connection=True;")
            .Options;

        return new AppDbContext(options);
    }
}
