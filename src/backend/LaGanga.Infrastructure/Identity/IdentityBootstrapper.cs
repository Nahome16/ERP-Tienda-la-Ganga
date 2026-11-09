using System.Security.Cryptography;
using System.Net.Mail;
using LaGanga.Application.Identity;
using LaGanga.Application.Users;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Identity;

public sealed class IdentityBootstrapper(
    LaGangaDbContext dbContext,
    IPasswordService passwordService,
    RoleSynchronizer roleSynchronizer,
    TimeProvider timeProvider)
{
    public async Task<bool> CreateInitialAdministratorInvitationAsync(
        string username,
        string displayName,
        string email,
        CancellationToken cancellationToken)
    {
        ValidateAccountData(username, displayName);
        if (!MailAddress.TryCreate(email?.Trim(), out var parsedEmail) ||
            !string.Equals(parsedEmail.Address, email.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("El correo del administrador no es válido.", nameof(email));
        }

        if (await dbContext.Users.AnyAsync(cancellationToken))
        {
            return false;
        }

        await roleSynchronizer.SynchronizeAsync(cancellationToken);
        var administratorRole = await dbContext.Roles
            .SingleAsync(role => role.Name == SystemRoles.Administrator, cancellationToken);

        var user = new UserAccount(Guid.NewGuid(), username.Trim(), displayName.Trim(), timeProvider.GetUtcNow());
        user.SetEmail(email);
        user.RequirePasswordChange();
        var unavailablePassword = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        user.SetPasswordHash(passwordService.HashPassword(user, unavailablePassword));
        user.AddRole(administratorRole);
        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> CreateInitialAdministratorAsync(
        string username,
        string displayName,
        string password,
        CancellationToken cancellationToken)
    {
        ValidateAccountData(username, displayName);
        if (password.Length is < UserRules.PasswordMinLength or > UserRules.PasswordMaxLength)
        {
            throw new ArgumentException($"La contraseña debe tener entre {UserRules.PasswordMinLength} y {UserRules.PasswordMaxLength} caracteres.", nameof(password));
        }

        if (await dbContext.Users.AnyAsync(cancellationToken))
        {
            return false;
        }

        await roleSynchronizer.SynchronizeAsync(cancellationToken);
        var administratorRole = await dbContext.Roles
            .SingleAsync(role => role.Name == SystemRoles.Administrator, cancellationToken);

        var user = new UserAccount(Guid.NewGuid(), username.Trim(), displayName.Trim(), timeProvider.GetUtcNow());
        user.SetPasswordHash(passwordService.HashPassword(user, password));
        user.AddRole(administratorRole);
        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private static void ValidateAccountData(string username, string displayName)
    {
        if (!UserRules.IsValidUsername(username.Trim()))
        {
            throw new ArgumentException("El usuario del administrador no es válido.", nameof(username));
        }

        if (string.IsNullOrWhiteSpace(displayName) || displayName.Trim().Length > UserRules.DisplayNameMaxLength)
        {
            throw new ArgumentException("El nombre visible del administrador no es válido.", nameof(displayName));
        }
    }
}
