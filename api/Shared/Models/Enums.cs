namespace SessionApp.Api.Models;

/// <summary>Rhythmic category of a traditional tune.</summary>
public enum TuneType
{
    Reel,
    Jig,
    SlipJig,
    Hornpipe,
    Polka,
    Slide,
    Waltz,
    March,
    Strathspey,
    Barndance,
    Mazurka,
    Air,
    Other
}

/// <summary>Where a tune sits in the user's practice lifecycle.</summary>
public enum TuneStatus
{
    Wishlist,
    Learning,
    Active,
    Rusty,
    Retired
}
