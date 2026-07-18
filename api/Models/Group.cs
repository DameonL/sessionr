namespace SessionApp.Api.Models;

/// <summary>A band or session group with shared dashboards.</summary>
public class Group
{
    public int GroupId { get; set; }
    public string Name { get; set; } = string.Empty;

    public ICollection<User> Members { get; set; } = new List<User>();
}
