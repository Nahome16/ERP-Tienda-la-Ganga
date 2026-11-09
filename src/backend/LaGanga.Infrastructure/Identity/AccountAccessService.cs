using System.Globalization;
using System.Net.Mail;
using System.Security.Cryptography;
using LaGanga.Application.Identity;
using LaGanga.Application.Users;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LaGanga.Infrastructure.Identity;

public sealed class AccountAccessService(
    LaGangaDbContext dbContext,
    IPasswordService passwordService,
    IEmailSender emailSender,
    AuthService authService,
    AccessCodeSettings settings,
    TimeProvider timeProvider,
    ILogger<AccountAccessService> logger) : IAccountAccessService
{
    private static readonly Action<ILogger, Guid, Exception?> LogEmailDeliveryFailure =
        LoggerMessage.Define<Guid>(
            LogLevel.Error,
            new EventId(1001, "AccessCodeEmailFailed"),
            "No se pudo enviar el código de acceso del usuario {UserId}.");

    public async Task RequestCodeAsync(string? email, CancellationToken cancellationToken)
    {
        var normalized = NormalizeValidEmail(email);
        if (normalized is null)
        {
            return;
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var user = await LockUserByEmailAsync(normalized, includePermissions: false, cancellationToken);
        var now = timeProvider.GetUtcNow();
        if (user is null || !user.IsActive || user.Email is null || !user.CanIssueVerificationCode(now, settings.ResendCooldown))
        {
            return;
        }

        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
        var expiresAt = now.Add(settings.Lifetime);
        user.BeginVerification(passwordService.HashPassword(user, code), now, expiresAt);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        try
        {
            await emailSender.SendAccessCodeAsync(user.Email, user.DisplayName, code, expiresAt, cancellationToken);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            // El endpoint siempre responde igual para no revelar si un correo tiene cuenta.
            // La falla queda en los registros operativos para que administración la atienda.
            LogEmailDeliveryFailure(logger, user.Id, exception);
        }
    }

    public async Task<AccessCodeResult> VerifyCodeAsync(
        string? email,
        string? code,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeValidEmail(email);
        var cleanCode = code?.Trim() ?? string.Empty;
        if (normalized is null || cleanCode.Length != 6 || cleanCode.Any(character => !char.IsAsciiDigit(character)))
        {
            return AccessCodeResult.Invalid(AccessCodeFailure.InvalidRequest);
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var user = await LockUserByEmailAsync(normalized, includePermissions: true, cancellationToken);
        var now = timeProvider.GetUtcNow();
        if (user is null || !user.IsActive || !user.CanVerifyCode(now, settings.MaximumAttempts))
        {
            return AccessCodeResult.Invalid(AccessCodeFailure.InvalidCode);
        }

        if (!passwordService.VerifyPassword(user, user.VerificationCodeHash!, cleanCode))
        {
            user.RegisterFailedVerificationAttempt();
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return AccessCodeResult.Invalid(AccessCodeFailure.InvalidCode);
        }

        user.RequirePasswordChange();
        user.ConsumeVerificationCode(now);
        var login = await authService.CreateSessionAsync(user, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return AccessCodeResult.Success(login);
    }

    public async Task<PasswordChangeResult> ChangePasswordAsync(
        Guid userId,
        Guid currentSessionId,
        bool emailCodeVerified,
        string? currentPassword,
        string? newPassword,
        CancellationToken cancellationToken)
    {
        if (newPassword is null || newPassword.Length is < UserRules.PasswordMinLength or > UserRules.PasswordMaxLength)
        {
            return PasswordChangeResult.Invalid(PasswordChangeFailure.InvalidRequest);
        }

        var user = await UsersWithPermissions().SingleOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);
        if (user is null || !user.IsActive)
        {
            return PasswordChangeResult.Invalid(PasswordChangeFailure.UserNotFound);
        }

        if ((!user.MustChangePassword || !emailCodeVerified) &&
            (string.IsNullOrWhiteSpace(currentPassword) || !passwordService.VerifyPassword(user, user.PasswordHash, currentPassword)))
        {
            return PasswordChangeResult.Invalid(PasswordChangeFailure.InvalidCurrentPassword);
        }

        user.SetPasswordHash(passwordService.HashPassword(user, newPassword));
        user.CompletePasswordChange();
        user.ConsumeVerificationCode(timeProvider.GetUtcNow());

        var now = timeProvider.GetUtcNow();
        var otherSessions = await dbContext.Sessions
            .Where(session => session.UserId == user.Id && session.Id != currentSessionId && session.RevokedAtUtc == null)
            .ToListAsync(cancellationToken);
        foreach (var session in otherSessions)
        {
            session.Revoke(now, "password_changed");
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return PasswordChangeResult.Success(AuthService.ToCurrentUser(user));
    }

    private IQueryable<UserAccount> UsersWithPermissions() =>
        dbContext.Users
            .Include(user => user.Roles)
                .ThenInclude(userRole => userRole.Role)
                    .ThenInclude(role => role.Permissions)
                        .ThenInclude(rolePermission => rolePermission.Permission);

    private async Task<UserAccount?> LockUserByEmailAsync(
        string normalizedEmail,
        bool includePermissions,
        CancellationToken cancellationToken)
    {
        var query = dbContext.Users
            .FromSqlInterpolated($"SELECT * FROM identity.users WHERE \"NormalizedEmail\" = {normalizedEmail} FOR UPDATE");
        if (includePermissions)
        {
            query = query
                .Include(user => user.Roles)
                    .ThenInclude(userRole => userRole.Role)
                        .ThenInclude(role => role.Permissions)
                            .ThenInclude(rolePermission => rolePermission.Permission)
                .AsSplitQuery();
        }

        return await query.SingleOrDefaultAsync(cancellationToken);
    }

    private static string? NormalizeValidEmail(string? email)
    {
        var value = email?.Trim() ?? string.Empty;
        return value.Length is > 0 and <= 254 && MailAddress.TryCreate(value, out var parsed) &&
            string.Equals(parsed.Address, value, StringComparison.OrdinalIgnoreCase)
                ? UserAccount.NormalizeEmail(value)
                : null;
    }
}
