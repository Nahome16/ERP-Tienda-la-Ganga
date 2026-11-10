using LaGanga.Application.Common;
using LaGanga.Application.Identity;
using LaGanga.Application.Inventory;
using LaGanga.Application.Sales;
using LaGanga.Application.Settings;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Sales;
using LaGanga.Infrastructure.Persistence;
using LaGanga.Infrastructure.Settings;
using Microsoft.EntityFrameworkCore;

namespace LaGanga.Infrastructure.Sales;

public sealed class PosService(
    LaGangaDbContext dbContext,
    IIdentityStore identityStore,
    IPasswordService passwordService,
    IAuditWriter audit,
    TimeProvider timeProvider) : IPosService
{
    private static readonly TimeSpan ApprovalLifetime = TimeSpan.FromMinutes(15);

    public async Task<PosSnapshotDto> GetSnapshotAsync(CancellationToken cancellationToken)
    {
        var settings = await dbContext.Settings.AsNoTracking().SingleAsync(cancellationToken);
        var variants = await (
            from variant in dbContext.Variants.AsNoTracking()
            join product in dbContext.Products on variant.ProductId equals product.Id
            join category in dbContext.Categories on product.CategoryId equals category.Id
            join brand in dbContext.Brands on product.BrandId equals brand.Id
            join size in dbContext.Sizes on variant.SizeId equals size.Id
            join color in dbContext.Colors on variant.ColorId equals color.Id
            join balance in dbContext.StockBalances on variant.Id equals balance.VariantId into balances
            from balance in balances.DefaultIfEmpty()
            where variant.IsActive && product.IsActive
            orderby product.Name, size.SortOrder, color.Name
            select new PosVariantDto(
                variant.Id,
                product.Id,
                product.Name,
                category.Name,
                brand.Name,
                size.Name,
                color.Name,
                color.SwatchHex,
                variant.Barcode,
                variant.PriceOverride ?? product.BasePrice,
                balance == null ? 0 : balance.Quantity,
                dbContext.ProductImages.Where(image => image.ProductId == product.Id)
                    .OrderBy(image => image.SortOrder).Select(image => MediaUrls.Prefix + image.ThumbFileName).FirstOrDefault(),
                product.Barcode))
            .ToListAsync(cancellationToken);
        return new PosSnapshotDto(timeProvider.GetUtcNow(), SettingsService.Map(settings), variants);
    }

    public async Task<ServiceResult<DiscountApprovalDto>> CreateDiscountApprovalAsync(
        DiscountApprovalRequest request,
        Actor actor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(actor);

        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password) || request.Password.Length > 256)
        {
            return Result.Fail<DiscountApprovalDto>(ServiceErrorKind.Validation, "validation_failed", "Ingresá el usuario y la contraseña del administrador.");
        }

        var approver = await identityStore.FindUserByNormalizedUsernameAsync(
            UserAccount.NormalizeUsername(request.Username), cancellationToken);
        if (approver is null || !approver.IsActive || !passwordService.VerifyPassword(approver, approver.PasswordHash, request.Password))
        {
            return Result.Fail<DiscountApprovalDto>(ServiceErrorKind.Unprocessable, "invalid_credentials", "Usuario o contraseña incorrectos.");
        }

        var allowed = approver.Roles.SelectMany(role => role.Role.Permissions)
            .Any(grant => string.Equals(grant.Permission.Name, PermissionNames.SaleDiscountUnlimited, StringComparison.Ordinal));
        if (!allowed)
        {
            return Result.Fail<DiscountApprovalDto>(ServiceErrorKind.Forbidden, "approver_not_allowed", "Esa cuenta no puede autorizar descuentos.");
        }

        var now = timeProvider.GetUtcNow();
        var approval = new DiscountApproval(Guid.NewGuid(), approver.Id, actor.UserId, now, now.Add(ApprovalLifetime));
        dbContext.DiscountApprovals.Add(approval);
        audit.Add(approver.Id, "discount.approved", "DiscountApproval", approval.Id.ToString(), $"{approver.DisplayName} autorizó un descuento sobre el límite solicitado en la caja.");
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Ok(new DiscountApprovalDto(approval.Id, approver.DisplayName, approval.ExpiresAtUtc));
    }
}
