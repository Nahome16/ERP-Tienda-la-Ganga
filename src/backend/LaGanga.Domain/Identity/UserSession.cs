namespace LaGanga.Domain.Identity;

public sealed class UserSession
{
    private UserSession()
    {
    }

    public UserSession(
        Guid id,
        Guid userId,
        string tokenIdentifier,
        string csrfTokenHash,
        DateTimeOffset createdAtUtc,
        DateTimeOffset expiresAtUtc)
    {
        Id = id;
        UserId = userId;
        TokenIdentifier = tokenIdentifier;
        CsrfTokenHash = csrfTokenHash;
        CreatedAtUtc = createdAtUtc;
        LastSeenAtUtc = createdAtUtc;
        ExpiresAtUtc = expiresAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid UserId { get; private set; }

    public string TokenIdentifier { get; private set; } = string.Empty;

    public string CsrfTokenHash { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset LastSeenAtUtc { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }

    public DateTimeOffset? RevokedAtUtc { get; private set; }

    public string? RevokedReason { get; private set; }

    public UserAccount User { get; private set; } = null!;

    public bool IsValidAt(DateTimeOffset checkedAtUtc, TimeSpan idleTimeout) =>
        RevokedAtUtc is null &&
        ExpiresAtUtc > checkedAtUtc &&
        LastSeenAtUtc.Add(idleTimeout) > checkedAtUtc;

    public void MarkSeen(DateTimeOffset seenAtUtc) => LastSeenAtUtc = seenAtUtc;

    public void Revoke(DateTimeOffset revokedAtUtc, string reason)
    {
        RevokedAtUtc = revokedAtUtc;
        RevokedReason = reason;
    }
}
