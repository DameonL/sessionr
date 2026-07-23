using System;

namespace SessionApp.Api.Functions;

/// <summary>
/// Declarative attribute indicating that an Azure Function method or class requires
/// valid Azure Entra ID Moderator group claims (Object ID 83bbddaa-d861-4904-a932-371f5d33dfe8).
/// Enforced automatically at the pipeline level by ModeratorAuthorizationMiddleware.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public class RequireModeratorAttribute : Attribute
{
}
