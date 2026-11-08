namespace LaGanga.Api.Identity;

public static class AuthConstants
{
    public const string AccessCookieName = "la_ganga_access";
    public const string CsrfCookieName = "la_ganga_csrf";
    public const string CsrfHeaderName = "X-CSRF-Token";
    public const string SessionIdClaim = "session_id";
    public const string PermissionClaim = "permission";
    public const string InventoryCostPolicy = "inventory-cost-read";
    public const string LoginRateLimitPolicy = "login";
}
