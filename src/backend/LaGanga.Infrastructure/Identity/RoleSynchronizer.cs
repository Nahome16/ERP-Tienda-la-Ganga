using LaGanga.Domain.Identity;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Identity;

/// <summary>
/// Asegura que existan todos los permisos definidos en el código y los roles
/// del sistema. Se puede ejecutar cuantas veces se quiera:
/// <list type="bullet">
/// <item>Agrega los permisos nuevos que todavía no estén en la base.</item>
/// <item>Crea los roles del sistema que falten, con sus permisos iniciales.</item>
/// <item>El rol Administrador recibe siempre todos los permisos.</item>
/// <item>Los roles del sistema reciben los permisos nuevos que el código les define.</item>
/// <item>Nunca quita permisos ni modifica roles creados por el negocio.</item>
/// </list>
/// </summary>
public sealed class RoleSynchronizer(LaGangaDbContext dbContext)
{
    public async Task<int> SynchronizeAsync(CancellationToken cancellationToken)
    {
        var permissions = await dbContext.Permissions.ToListAsync(cancellationToken);
        var byName = permissions.ToDictionary(permission => permission.Name, StringComparer.Ordinal);
        foreach (var name in PermissionNames.All)
        {
            if (!byName.ContainsKey(name))
            {
                var permission = new PermissionGrant(Guid.NewGuid(), name);
                dbContext.Permissions.Add(permission);
                byName[name] = permission;
            }
        }

        var roles = await dbContext.Roles
            .Include(role => role.Permissions)
            .ToListAsync(cancellationToken);

        foreach (var (roleName, defaultPermissions) in SystemRoles.Defaults)
        {
            var normalized = roleName.Trim().ToUpperInvariant();
            var role = roles.SingleOrDefault(candidate => candidate.NormalizedName == normalized);
                        if (role is null)
            {
                role = new Role(Guid.NewGuid(), roleName);
                dbContext.Roles.Add(role);
                roles.Add(role);
            }

            // Los roles del sistema reciben siempre los permisos que el código les define
            // (así una actualización que agrega permisos nuevos los habilita sin pasos manuales).
            // Nunca se quita un permiso ya asignado.
            foreach (var permissionName in defaultPermissions)
            {
                var permission = byName[permissionName];
                if (!role.HasPermission(permission.Id))
                {
                    role.AddPermission(permission);
                }
            }
        }

        return await dbContext.SaveChangesAsync(cancellationToken);
    }
}
