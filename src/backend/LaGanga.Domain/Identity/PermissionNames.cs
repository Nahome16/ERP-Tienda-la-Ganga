namespace LaGanga.Domain.Identity;

public static class PermissionNames
{
    public const string CatalogRead = "catalog.read";
    public const string CatalogManage = "catalog.manage";
    public const string ProductRead = "product.read";
    public const string ProductCreate = "product.create";
    public const string ProductEdit = "product.edit";
    public const string ProductStatusManage = "product.status.manage";
    public const string ProductArchive = "product.archive";
    public const string ProductImagesManage = "product.images.manage";
    public const string InventoryRead = "inventory.read";
    public const string InventoryKardexRead = "inventory.kardex.read";
    public const string InventoryCostRead = "inventory.cost.read";
    public const string InventoryInitialConfirm = "inventory.initial.confirm";
    public const string InventoryAdjust = "inventory.adjust";
    public const string InventoryAdjustAuthorize = "inventory.adjust.authorize";

    public static IReadOnlyCollection<string> All { get; } =
    [
        CatalogRead,
        CatalogManage,
        ProductRead,
        ProductCreate,
        ProductEdit,
        ProductStatusManage,
        ProductArchive,
        ProductImagesManage,
        InventoryRead,
        InventoryKardexRead,
        InventoryCostRead,
        InventoryInitialConfirm,
        InventoryAdjust,
        InventoryAdjustAuthorize,
    ];
}
