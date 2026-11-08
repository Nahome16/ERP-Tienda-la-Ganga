using LaGanga.Application.Identity;
using LaGanga.Application.Settings;
using LaGanga.Application.Users;
using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LaGanga.Infrastructure.Identity;

public sealed class UserAdminService(
    LaGangaDbContext dbContext,
    IPasswordService passwordService,
    IAuditWriter audit,
    TimeProvider timeProvider) : IUserAdminService
{
    public async Task<IReadOnlyList<UserSummaryDto>> ListUsersAsync(CancellationToken cancellationToken)
    {
        var users = await UsersWithRoles()
            .AsNoTracking()
            .OrderByDescending(user => user.IsActive)
            .ThenBy(user => user.DisplayName)
            .ToListAsync(cancellationToken);
        return users.Select(Map).ToArray();
    }

    public async Task<IReadOnlyList<RoleDto>> ListRolesAsync(CancellationToken cancellationToken)
    {
        var roles = await dbContext.Roles
            .AsNoTracking()
            .Include(role => role.Permissions)
                .ThenInclude(grant => grant.Permission)
            .OrderBy(role => role.Name)
            .ToListAsync(cancellationToken);
        return roles
            .Select(role => new RoleDto(
                role.Id,
                role.Name,
                role.Permissions
                    .Select(grant => grant.Permission.Name)
                    .Order(StringComparer.Ordinal)
                    .ToArray()))
            .ToArray();
    }

    public async Task<UserAdminResult<UserSummaryDto>> CreateAsync(
        CreateUserInput input,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);

        var username = input.Username?.Trim() ?? string.Empty;
        if (!UserRules.IsValidUsername(username))
        {
            return Fail(Validation(
                "username",
                $"El usuario debe tener entre {UserRules.UsernameMinLength} y {UserRules.UsernameMaxLength} caracteres: letras sin acentos, números, punto, guion o guion bajo."));
        }

        var displayNameError = ValidateDisplayName(input.DisplayName);
        if (displayNameError is not null)
        {
            return Fail(displayNameError);
        }

        var passwordError = ValidatePassword(input.Password);
        if (passwordError is not null)
        {
            return Fail(passwordError);
        }

        var (roles, rolesError) = await LoadRolesAsync(input.RoleIds, cancellationToken);
        if (rolesError is not null)
        {
            return Fail(rolesError);
        }

        var normalizedUsername = UserAccount.NormalizeUsername(username);
        if (await dbContext.Users.AnyAsync(user => user.NormalizedUsername == normalizedUsername, cancellationToken))
        {
            return Fail(DuplicateUsername());
        }

        var user = new UserAccount(Guid.NewGuid(), username, input.DisplayName!.Trim(), timeProvider.GetUtcNow());
        user.SetPasswordHash(passwordService.HashPassword(user, input.Password!));
        foreach (var role in roles)
        {
            user.AddRole(role);
        }

        dbContext.Users.Add(user);
        audit.Add(actorId, "user.created", "User", user.Id.ToString(), $"Cuenta «{user.Username}» creada con rol(es): {string.Join(", ", roles.Select(role => role.Name))}.");
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Fail(DuplicateUsername());
        }

        return await ReloadAsync(user.Id, cancellationToken);
    }

    public async Task<UserAdminResult<UserSummaryDto>> UpdateAsync(
        Guid userId,
        UpdateUserInput input,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);

        var user = await UsersWithRoles().SingleOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);
        if (user is null)
        {
            return Fail(NotFound());
        }

        var displayNameError = ValidateDisplayName(input.DisplayName);
        if (displayNameError is not null)
        {
            return Fail(displayNameError);
        }

        var (roles, rolesError) = await LoadRolesAsync(input.RoleIds, cancellationToken);
        if (rolesError is not null)
        {
            return Fail(rolesError);
        }

        var willBeActive = input.IsActive ?? user.IsActive;
        var willBeAdministrator = roles.Exists(role => role.Name == SystemRoles.Administrator);
        var isSelf = user.Id == actorId;

        if (isSelf && !willBeActive)
        {
            return Fail(Rule("cannot_deactivate_self", "No podés desactivar tu propia cuenta."));
        }

        if (isSelf && !willBeAdministrator && IsAdministrator(user))
        {
            return Fail(Rule("cannot_remove_own_admin", "No podés quitarte el rol Administrador a vos mismo."));
        }

        if (IsAdministrator(user) && user.IsActive && (!willBeActive || !willBeAdministrator))
        {
            var otherActiveAdministrators = await dbContext.Users.CountAsync(
                candidate => candidate.Id != user.Id &&
                    candidate.IsActive &&
                    candidate.Roles.Any(userRole => userRole.Role.Name == SystemRoles.Administrator),
                cancellationToken);
            if (otherActiveAdministrators == 0)
            {
                return Fail(Rule(
                    "last_administrator",
                    "Debe quedar al menos un administrador activo."));
            }
        }

        user.ChangeDisplayName(input.DisplayName!);

        var wanted = roles.Select(role => role.Id).ToHashSet();
        var removed = user.Roles.Where(userRole => !wanted.Contains(userRole.RoleId)).ToList();
        user.ReplaceRoles(roles);
        dbContext.UserRoles.RemoveRange(removed);

        var wasActive = user.IsActive;
        if (willBeActive)
        {
            user.Activate();
        }
        else
        {
            user.Deactivate();
        }

        if (wasActive && !willBeActive)
        {
            await RevokeSessionsAsync(user.Id, "user_deactivated", cancellationToken);
        }

        audit.Add(actorId, "user.updated", "User", user.Id.ToString(), $"Cuenta «{user.Username}» actualizada ({(willBeActive ? "activa" : "inactiva")}).");
        await dbContext.SaveChangesAsync(cancellationToken);
        return await ReloadAsync(user.Id, cancellationToken);
    }

    public async Task<UserAdminResult<UserSummaryDto>> ResetPasswordAsync(
        Guid userId,
        string? newPassword,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        var user = await dbContext.Users.SingleOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);
        if (user is null)
        {
            return Fail(NotFound());
        }

        var passwordError = ValidatePassword(newPassword);
        if (passwordError is not null)
        {
            return Fail(passwordError);
        }

        user.SetPasswordHash(passwordService.HashPassword(user, newPassword!));
        await RevokeSessionsAsync(user.Id, "password_reset", cancellationToken);
        audit.Add(actorId, "user.password_reset", "User", user.Id.ToString(), $"Contraseña de «{user.Username}» restablecida.");
        await dbContext.SaveChangesAsync(cancellationToken);
        return await ReloadAsync(user.Id, cancellationToken);
    }

    private IQueryable<UserAccount> UsersWithRoles() =>
        dbContext.Users
            .Include(user => user.Roles)
                .ThenInclude(userRole => userRole.Role);

    private async Task<UserAdminResult<UserSummaryDto>> ReloadAsync(Guid userId, CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var user = await UsersWithRoles().AsNoTracking().SingleAsync(candidate => candidate.Id == userId, cancellationToken);
        return UserAdminResult.Success(Map(user));
    }

    private async Task<(List<Role> Roles, UserAdminError? Error)> LoadRolesAsync(
        IReadOnlyList<Guid>? roleIds,
        CancellationToken cancellationToken)
    {
        var ids = (roleIds ?? []).Distinct().ToArray();
        if (ids.Length == 0)
        {
            return ([], Validation("roleIds", "Asigná al menos un rol."));
        }

        var roles = await dbContext.Roles.Where(role => ids.Contains(role.Id)).ToListAsync(cancellationToken);
        return roles.Count == ids.Length
            ? (roles, null)
            : (roles, Validation("roleIds", "Uno de los roles indicados no existe."));
    }

    private async Task RevokeSessionsAsync(Guid userId, string reason, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var sessions = await dbContext.Sessions
            .Where(session => session.UserId == userId && session.RevokedAtUtc == null)
            .ToListAsync(cancellationToken);
        foreach (var session in sessions)
        {
            session.Revoke(now, reason);
        }
    }

    private static bool IsAdministrator(UserAccount user) =>
        user.Roles.Any(userRole => userRole.Role.Name == SystemRoles.Administrator);

    private static UserAdminError? ValidateDisplayName(string? displayName)
    {
        var value = displayName?.Trim() ?? string.Empty;
        if (value.Length == 0)
        {
            return Validation("displayName", "El nombre visible es obligatorio.");
        }

        return value.Length > UserRules.DisplayNameMaxLength
            ? Validation("displayName", $"El nombre visible admite como máximo {UserRules.DisplayNameMaxLength} caracteres.")
            : null;
    }

    private static UserAdminError? ValidatePassword(string? password) =>
        password is null || password.Length < UserRules.PasswordMinLength || password.Length > UserRules.PasswordMaxLength
            ? Validation("password", $"La contraseña debe tener al menos {UserRules.PasswordMinLength} caracteres.")
            : null;

    private static UserSummaryDto Map(UserAccount user) =>
        new(
            user.Id,
            user.Username,
            user.DisplayName,
            user.IsActive,
            user.Roles
                .Select(userRole => new RoleReferenceDto(userRole.RoleId, userRole.Role.Name))
                .OrderBy(role => role.Name, StringComparer.Ordinal)
                .ToArray(),
            user.CreatedAtUtc,
            user.LastLoginAtUtc);

    private static UserAdminResult<UserSummaryDto> Fail(UserAdminError error) =>
        UserAdminResult.Failure<UserSummaryDto>(error);

    private static UserAdminError Validation(string field, string message) =>
        new(UserAdminErrorKind.Validation, "validation_failed", message, field);

    private static UserAdminError Rule(string code, string message) =>
        new(UserAdminErrorKind.BusinessRule, code, message);

    private static UserAdminError NotFound() =>
        new(UserAdminErrorKind.NotFound, "not_found", "No se encontró la cuenta.");

    private static UserAdminError DuplicateUsername() =>
        new(UserAdminErrorKind.Conflict, "duplicate_username", "Ya existe una cuenta con ese usuario.", "username");
}
