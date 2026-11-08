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
    public const string UserManage = "user.manage";
    public const string SaleCreate = "sale.create";
    public const string SaleRead = "sale.read";
    public const string SaleVoid = "sale.void";
    public const string SaleDiscountUnlimited = "sale.discount.unlimited";
    public const string CashOperate = "cash.operate";
    public const string CashReportRead = "cash.report.read";
    public const string SettingsManage = "settings.manage";
    public const string AuditRead = "audit.read";
    public const string InvestmentRead = "investment.read";
    public const string InvestmentManage = "investment.manage";

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
        UserManage,
        SaleCreate,
        SaleRead,
        SaleVoid,
        SaleDiscountUnlimited,
        CashOperate,
        CashReportRead,
        SettingsManage,
        AuditRead,
        InvestmentRead,
        InvestmentManage,
    ];
}
