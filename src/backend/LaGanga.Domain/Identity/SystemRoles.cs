namespace LaGanga.Domain.Identity;

/// <summary>
/// Roles iniciales y sus permisos según la matriz del Módulo 0 (sección 5) y
/// del Módulo 1 (sección 14). El administrador siempre recibe todos.
/// </summary>
public static class SystemRoles
{
    public const string Administrator = "Administrador";
    public const string Seller = "Vendedor";
    public const string InventoryManager = "Encargado de inventario";

    /// <summary>Vende y maneja su caja; consulta productos y disponibilidad, sin costos ni ajustes.</summary>
    public static IReadOnlyCollection<string> SellerPermissions { get; } =
    [
        PermissionNames.CatalogRead,
        PermissionNames.ProductRead,
        PermissionNames.InventoryRead,
        PermissionNames.SaleCreate,
        PermissionNames.SaleExchange,
        PermissionNames.CashOperate,
    ];

    /// <summary>
    /// Mantiene productos e inventario. Costos y autorización de ajustes
    /// quedan fuera hasta definir sus límites («Limitado» en la matriz).
    /// </summary>
    public static IReadOnlyCollection<string> InventoryManagerPermissions { get; } =
    [
        PermissionNames.CatalogRead,
        PermissionNames.CatalogManage,
        PermissionNames.ProductRead,
        PermissionNames.ProductCreate,
        PermissionNames.ProductEdit,
        PermissionNames.ProductStatusManage,
        PermissionNames.ProductImagesManage,
        PermissionNames.InventoryRead,
        PermissionNames.InventoryKardexRead,
        PermissionNames.InventoryInitialConfirm,
        PermissionNames.InventoryAdjust,
    ];

    public static IReadOnlyDictionary<string, IReadOnlyCollection<string>> Defaults { get; } =
        new Dictionary<string, IReadOnlyCollection<string>>(StringComparer.Ordinal)
        {
            [Administrator] = PermissionNames.All,
            [Seller] = SellerPermissions,
            [InventoryManager] = InventoryManagerPermissions,
        };
}
