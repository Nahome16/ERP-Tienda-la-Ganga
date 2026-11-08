using LaGanga.Application.Catalog;
using LaGanga.Domain.Catalog;
using LaGanga.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LaGanga.Infrastructure.Catalog;

public sealed class CatalogService(LaGangaDbContext dbContext, TimeProvider timeProvider)
    : ICatalogService
{
    private const string SortDescription = "sortOrder:asc,name:asc";

    public Task<PagedResult<CatalogItemDto>> ListAsync(
        CatalogKind kind,
        CatalogListQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        return kind switch
        {
            CatalogKind.Categories => ListCoreAsync(
                query.ParentId is { } parentId
                    ? dbContext.Categories.Where(category => category.ParentId == parentId)
                    : dbContext.Categories,
                query,
                cancellationToken),
            CatalogKind.Brands => ListCoreAsync(dbContext.Brands, query, cancellationToken),
            CatalogKind.Cuts => ListCoreAsync(dbContext.Cuts, query, cancellationToken),
            CatalogKind.SizeGroups => ListCoreAsync(dbContext.SizeGroups, query, cancellationToken),
            CatalogKind.Sizes => ListCoreAsync(
                query.SizeGroupId is { } groupId
                    ? dbContext.Sizes.Where(size => size.SizeGroupId == groupId)
                    : dbContext.Sizes,
                query,
                cancellationToken),
            CatalogKind.Colors => ListCoreAsync(dbContext.Colors, query, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
    }

    public async Task<CatalogResult<CatalogItemDto>> GetAsync(
        CatalogKind kind,
        Guid id,
        CancellationToken cancellationToken)
    {
        var entry = await FindAsync(kind, id, cancellationToken);
        return entry is null
            ? CatalogResult.Failure<CatalogItemDto>(NotFound(kind))
            : CatalogResult.Success(Map(entry));
    }

    public async Task<CatalogResult<CatalogItemDto>> CreateAsync(
        CatalogKind kind,
        CatalogItemInput input,
        Guid userId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);

        var validation = ValidateBasics(kind, input);
        if (validation is not null)
        {
            return CatalogResult.Failure<CatalogItemDto>(validation);
        }

        var referenceError = await ValidateReferencesAsync(kind, null, input, cancellationToken);
        if (referenceError is not null)
        {
            return CatalogResult.Failure<CatalogItemDto>(referenceError);
        }

        var normalizedName = CatalogText.Normalize(input.Name);
        if (await IsDuplicateAsync(kind, null, normalizedName, input, cancellationToken))
        {
            return CatalogResult.Failure<CatalogItemDto>(Duplicate(kind));
        }

        var now = timeProvider.GetUtcNow();
        var sortOrder = input.SortOrder ?? await NextSortOrderAsync(kind, cancellationToken);
        CatalogEntry entry;
        try
        {
            entry = kind switch
            {
                CatalogKind.Categories => new Category(Guid.NewGuid(), input.Name!, input.ParentId, sortOrder, userId, now),
                CatalogKind.Brands => new Brand(Guid.NewGuid(), input.Name!, sortOrder, userId, now),
                CatalogKind.Cuts => new Cut(Guid.NewGuid(), input.Name!, sortOrder, userId, now),
                CatalogKind.SizeGroups => new SizeGroup(Guid.NewGuid(), input.Name!, sortOrder, userId, now),
                CatalogKind.Sizes => new Size(Guid.NewGuid(), input.Name!, input.SizeGroupId, sortOrder, userId, now),
                CatalogKind.Colors => new Color(Guid.NewGuid(), input.Name!, input.SwatchHex, sortOrder, userId, now),
                _ => throw new ArgumentOutOfRangeException(nameof(kind)),
            };

            if (input.IsActive == false)
            {
                entry.Inactivate(userId, now);
            }
        }
        catch (CatalogRuleException exception)
        {
            return CatalogResult.Failure<CatalogItemDto>(FromRule(exception));
        }

        dbContext.Add(entry);
        var saveError = await SaveAsync(kind, cancellationToken);
        return saveError is null
            ? CatalogResult.Success(Map(entry))
            : CatalogResult.Failure<CatalogItemDto>(saveError);
    }

    public async Task<CatalogResult<CatalogItemDto>> UpdateAsync(
        CatalogKind kind,
        Guid id,
        long expectedVersion,
        CatalogItemInput input,
        Guid userId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);

        var entry = await FindAsync(kind, id, cancellationToken);
        if (entry is null)
        {
            return CatalogResult.Failure<CatalogItemDto>(NotFound(kind));
        }

        if (entry.Version != expectedVersion)
        {
            return CatalogResult.Failure<CatalogItemDto>(VersionConflict());
        }

        var validation = ValidateBasics(kind, input);
        if (validation is not null)
        {
            return CatalogResult.Failure<CatalogItemDto>(validation);
        }

        var referenceError = await ValidateReferencesAsync(kind, entry, input, cancellationToken);
        if (referenceError is not null)
        {
            return CatalogResult.Failure<CatalogItemDto>(referenceError);
        }

        var normalizedName = CatalogText.Normalize(input.Name);
        if (await IsDuplicateAsync(kind, id, normalizedName, input, cancellationToken))
        {
            return CatalogResult.Failure<CatalogItemDto>(Duplicate(kind));
        }

        if (input.IsActive is { } requestedActive && requestedActive != entry.IsActive)
        {
            var statusError = await ValidateStatusChangeAsync(entry, requestedActive, input, cancellationToken);
            if (statusError is not null)
            {
                return CatalogResult.Failure<CatalogItemDto>(statusError);
            }
        }

        var now = timeProvider.GetUtcNow();
        try
        {
            entry.Update(input.Name!, input.SortOrder ?? entry.SortOrder, userId, now);
            switch (entry)
            {
                case Category category:
                    category.ChangeParent(input.ParentId, userId, now);
                    break;
                case Size size:
                    size.ChangeGroup(input.SizeGroupId, userId, now);
                    break;
                case Color color:
                    color.ChangeSwatch(input.SwatchHex, userId, now);
                    break;
            }

            ApplyStatus(entry, input.IsActive, userId, now);
        }
        catch (CatalogRuleException exception)
        {
            return CatalogResult.Failure<CatalogItemDto>(FromRule(exception));
        }

        UseExpectedVersion(entry, expectedVersion);
        var saveError = await SaveAsync(kind, cancellationToken);
        return saveError is null
            ? CatalogResult.Success(Map(entry))
            : CatalogResult.Failure<CatalogItemDto>(saveError);
    }

    public async Task<CatalogResult<CatalogItemDto>> SetActiveAsync(
        CatalogKind kind,
        Guid id,
        long expectedVersion,
        bool isActive,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var entry = await FindAsync(kind, id, cancellationToken);
        if (entry is null)
        {
            return CatalogResult.Failure<CatalogItemDto>(NotFound(kind));
        }

        if (entry.Version != expectedVersion)
        {
            return CatalogResult.Failure<CatalogItemDto>(VersionConflict());
        }

        if (entry.IsActive == isActive)
        {
            return CatalogResult.Success(Map(entry));
        }

        var statusError = await ValidateStatusChangeAsync(entry, isActive, null, cancellationToken);
        if (statusError is not null)
        {
            return CatalogResult.Failure<CatalogItemDto>(statusError);
        }

        ApplyStatus(entry, isActive, userId, timeProvider.GetUtcNow());
        UseExpectedVersion(entry, expectedVersion);
        var saveError = await SaveAsync(kind, cancellationToken);
        return saveError is null
            ? CatalogResult.Success(Map(entry))
            : CatalogResult.Failure<CatalogItemDto>(saveError);
    }

    private static async Task<PagedResult<CatalogItemDto>> ListCoreAsync<T>(
        IQueryable<T> source,
        CatalogListQuery query,
        CancellationToken cancellationToken)
        where T : CatalogEntry
    {
        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, CatalogListQuery.MaxPageSize);

        source = query.Status switch
        {
            CatalogStatusFilter.Active => source.Where(entry => entry.IsActive),
            CatalogStatusFilter.Inactive => source.Where(entry => !entry.IsActive),
            _ => source,
        };

        var search = CatalogText.Normalize(query.Search);
        if (search.Length > 0)
        {
            source = source.Where(entry => entry.NormalizedName.Contains(search));
        }

        var totalCount = await source.CountAsync(cancellationToken);
        var entries = await source
            .OrderBy(entry => entry.SortOrder)
            .ThenBy(entry => entry.Name)
            .ThenBy(entry => entry.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        return new PagedResult<CatalogItemDto>(
            entries.Select(Map).ToArray(),
            page,
            pageSize,
            totalCount,
            (int)Math.Ceiling(totalCount / (double)pageSize),
            SortDescription);
    }

    private async Task<CatalogEntry?> FindAsync(
        CatalogKind kind,
        Guid id,
        CancellationToken cancellationToken)
    {
        switch (kind)
        {
            case CatalogKind.Categories:
                return await dbContext.Categories.SingleOrDefaultAsync(entry => entry.Id == id, cancellationToken);
            case CatalogKind.Brands:
                return await dbContext.Brands.SingleOrDefaultAsync(entry => entry.Id == id, cancellationToken);
            case CatalogKind.Cuts:
                return await dbContext.Cuts.SingleOrDefaultAsync(entry => entry.Id == id, cancellationToken);
            case CatalogKind.SizeGroups:
                return await dbContext.SizeGroups.SingleOrDefaultAsync(entry => entry.Id == id, cancellationToken);
            case CatalogKind.Sizes:
                return await dbContext.Sizes.SingleOrDefaultAsync(entry => entry.Id == id, cancellationToken);
            case CatalogKind.Colors:
                return await dbContext.Colors.SingleOrDefaultAsync(entry => entry.Id == id, cancellationToken);
            default:
                throw new ArgumentOutOfRangeException(nameof(kind));
        }
    }

    private static CatalogError? ValidateBasics(CatalogKind kind, CatalogItemInput input)
    {
        var name = CatalogText.CleanVisibleName(input.Name);
        if (name.Length == 0)
        {
            return new CatalogError(
                CatalogErrorKind.Validation,
                "validation_failed",
                "El nombre es obligatorio.",
                "name");
        }

        var maxLength = MaxNameLength(kind);
        if (name.Length > maxLength)
        {
            return new CatalogError(
                CatalogErrorKind.Validation,
                "validation_failed",
                $"El nombre admite como máximo {maxLength} caracteres.",
                "name");
        }

        if (input.SortOrder is < 0)
        {
            return new CatalogError(
                CatalogErrorKind.Validation,
                "validation_failed",
                "El orden debe ser cero o mayor.",
                "sortOrder");
        }

        if (kind == CatalogKind.Colors)
        {
            try
            {
                Color.NormalizeSwatch(input.SwatchHex);
            }
            catch (CatalogRuleException exception)
            {
                return new CatalogError(
                    CatalogErrorKind.Validation,
                    "validation_failed",
                    exception.Message,
                    "swatchHex");
            }
        }

        return null;
    }

    private async Task<CatalogError?> ValidateReferencesAsync(
        CatalogKind kind,
        CatalogEntry? existing,
        CatalogItemInput input,
        CancellationToken cancellationToken)
    {
        if (kind == CatalogKind.Categories && input.ParentId is { } parentId)
        {
            var keepsSameParent = existing is Category current && current.ParentId == parentId;
            var parent = await dbContext.Categories
                .AsNoTracking()
                .SingleOrDefaultAsync(category => category.Id == parentId, cancellationToken);
            if (parent is null)
            {
                return new CatalogError(
                    CatalogErrorKind.Validation,
                    "parent_not_found",
                    "La categoría superior no existe.",
                    "parentId");
            }

            if (!parent.IsActive && !keepsSameParent)
            {
                return new CatalogError(
                    CatalogErrorKind.BusinessRule,
                    "parent_inactive",
                    "La categoría superior está inactiva.",
                    "parentId");
            }

            if (existing is not null)
            {
                var parents = await dbContext.Categories
                    .AsNoTracking()
                    .Select(category => new { category.Id, category.ParentId })
                    .ToDictionaryAsync(category => category.Id, category => category.ParentId, cancellationToken);
                if (CategoryHierarchy.WouldCreateCycle(existing.Id, parentId, parents))
                {
                    return new CatalogError(
                        CatalogErrorKind.BusinessRule,
                        "category_cycle",
                        "No se puede colocar una categoría dentro de una de sus subcategorías.",
                        "parentId");
                }
            }
        }

        if (kind == CatalogKind.Sizes && input.SizeGroupId is { } groupId)
        {
            var keepsSameGroup = existing is Size current && current.SizeGroupId == groupId;
            var group = await dbContext.SizeGroups
                .AsNoTracking()
                .SingleOrDefaultAsync(sizeGroup => sizeGroup.Id == groupId, cancellationToken);
            if (group is null)
            {
                return new CatalogError(
                    CatalogErrorKind.Validation,
                    "size_group_not_found",
                    "El grupo de tallas no existe.",
                    "sizeGroupId");
            }

            if (!group.IsActive && !keepsSameGroup)
            {
                return new CatalogError(
                    CatalogErrorKind.BusinessRule,
                    "size_group_inactive",
                    "El grupo de tallas está inactivo.",
                    "sizeGroupId");
            }
        }

        return null;
    }

    private async Task<CatalogError?> ValidateStatusChangeAsync(
        CatalogEntry entry,
        bool becomesActive,
        CatalogItemInput? input,
        CancellationToken cancellationToken)
    {
        if (entry is not Category category)
        {
            return null;
        }

        if (!becomesActive)
        {
            var hasActiveChildren = await dbContext.Categories
                .AnyAsync(child => child.ParentId == category.Id && child.IsActive, cancellationToken);
            return hasActiveChildren
                ? new CatalogError(
                    CatalogErrorKind.BusinessRule,
                    "category_has_active_children",
                    "Primero inactivá las subcategorías activas de esta categoría.")
                : null;
        }

        var parentId = input is null ? category.ParentId : input.ParentId;
        if (parentId is { } id)
        {
            var parentIsActive = await dbContext.Categories
                .AnyAsync(parent => parent.Id == id && parent.IsActive, cancellationToken);
            if (!parentIsActive)
            {
                return new CatalogError(
                    CatalogErrorKind.BusinessRule,
                    "parent_inactive",
                    "Activá primero la categoría superior.");
            }
        }

        return null;
    }

    private async Task<bool> IsDuplicateAsync(
        CatalogKind kind,
        Guid? excludeId,
        string normalizedName,
        CatalogItemInput input,
        CancellationToken cancellationToken)
    {
        return kind switch
        {
            CatalogKind.Categories => await dbContext.Categories.AnyAsync(
                entry => entry.Id != excludeId &&
                    entry.ParentId == input.ParentId &&
                    entry.NormalizedName == normalizedName,
                cancellationToken),
            CatalogKind.Brands => await dbContext.Brands.AnyAsync(
                entry => entry.Id != excludeId && entry.NormalizedName == normalizedName,
                cancellationToken),
            CatalogKind.Cuts => await dbContext.Cuts.AnyAsync(
                entry => entry.Id != excludeId && entry.NormalizedName == normalizedName,
                cancellationToken),
            CatalogKind.SizeGroups => await dbContext.SizeGroups.AnyAsync(
                entry => entry.Id != excludeId && entry.NormalizedName == normalizedName,
                cancellationToken),
            CatalogKind.Sizes => await dbContext.Sizes.AnyAsync(
                entry => entry.Id != excludeId &&
                    entry.SizeGroupId == input.SizeGroupId &&
                    entry.NormalizedName == normalizedName,
                cancellationToken),
            CatalogKind.Colors => await dbContext.Colors.AnyAsync(
                entry => entry.Id != excludeId && entry.NormalizedName == normalizedName,
                cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
    }

    private async Task<int> NextSortOrderAsync(CatalogKind kind, CancellationToken cancellationToken)
    {
        var maximum = kind switch
        {
            CatalogKind.Categories => await dbContext.Categories.MaxAsync(entry => (int?)entry.SortOrder, cancellationToken),
            CatalogKind.Brands => await dbContext.Brands.MaxAsync(entry => (int?)entry.SortOrder, cancellationToken),
            CatalogKind.Cuts => await dbContext.Cuts.MaxAsync(entry => (int?)entry.SortOrder, cancellationToken),
            CatalogKind.SizeGroups => await dbContext.SizeGroups.MaxAsync(entry => (int?)entry.SortOrder, cancellationToken),
            CatalogKind.Sizes => await dbContext.Sizes.MaxAsync(entry => (int?)entry.SortOrder, cancellationToken),
            CatalogKind.Colors => await dbContext.Colors.MaxAsync(entry => (int?)entry.SortOrder, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };

        return (maximum ?? 0) + 10;
    }

    private static void ApplyStatus(CatalogEntry entry, bool? isActive, Guid userId, DateTimeOffset now)
    {
        if (isActive == true)
        {
            entry.Activate(userId, now);
        }
        else if (isActive == false)
        {
            entry.Inactivate(userId, now);
        }
    }

    private void UseExpectedVersion(CatalogEntry entry, long expectedVersion) =>
        dbContext.Entry(entry).Property(catalogEntry => catalogEntry.Version).OriginalValue = expectedVersion;

    private async Task<CatalogError?> SaveAsync(CatalogKind kind, CancellationToken cancellationToken)
    {
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return VersionConflict();
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Duplicate(kind);
        }
    }

    private static CatalogItemDto Map(CatalogEntry entry) =>
        new(
            entry.Id,
            entry.Name,
            entry.IsActive,
            entry.SortOrder,
            entry.Version,
            (entry as Category)?.ParentId,
            (entry as Size)?.SizeGroupId,
            (entry as Color)?.SwatchHex,
            entry.UpdatedAtUtc);

    private static int MaxNameLength(CatalogKind kind) => kind switch
    {
        CatalogKind.Categories => Category.NameMaxLength,
        CatalogKind.Brands => Brand.NameMaxLength,
        CatalogKind.Cuts => Cut.NameMaxLength,
        CatalogKind.SizeGroups => SizeGroup.NameMaxLength,
        CatalogKind.Sizes => Size.NameMaxLength,
        CatalogKind.Colors => Color.NameMaxLength,
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private static CatalogError FromRule(CatalogRuleException exception) =>
        new(CatalogErrorKind.Validation, exception.Code, exception.Message);

    private static CatalogError NotFound(CatalogKind kind) =>
        new(CatalogErrorKind.NotFound, "not_found", $"No se encontró el elemento de {Describe(kind)}.");

    private static CatalogError Duplicate(CatalogKind kind) =>
        new(
            CatalogErrorKind.Conflict,
            "duplicate_name",
            $"Ya existe un elemento con ese nombre en {Describe(kind)}.",
            "name");

    private static CatalogError VersionConflict() =>
        new(
            CatalogErrorKind.Conflict,
            "version_conflict",
            "Otra persona modificó este elemento. Recargá los datos e intentá de nuevo.");

    private static string Describe(CatalogKind kind) => kind switch
    {
        CatalogKind.Categories => "categorías",
        CatalogKind.Brands => "marcas",
        CatalogKind.Cuts => "cortes",
        CatalogKind.SizeGroups => "grupos de tallas",
        CatalogKind.Sizes => "tallas",
        CatalogKind.Colors => "colores",
        _ => "catálogos",
    };
}
