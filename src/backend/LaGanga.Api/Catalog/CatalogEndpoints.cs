using System.Globalization;
using System.Security.Claims;
using LaGanga.Api.Identity;
using LaGanga.Application.Catalog;
using LaGanga.Domain.Identity;
using Microsoft.AspNetCore.Mvc;

namespace LaGanga.Api.Catalog;

public static class CatalogEndpoints
{
    private static readonly (string Segment, CatalogKind Kind)[] Routes =
    [
        ("categories", CatalogKind.Categories),
        ("brands", CatalogKind.Brands),
        ("cuts", CatalogKind.Cuts),
        ("size-groups", CatalogKind.SizeGroups),
        ("sizes", CatalogKind.Sizes),
        ("colors", CatalogKind.Colors),
    ];

    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var catalog = endpoints.MapGroup("/api/v1/catalog").WithTags("Catalog");

        foreach (var (segment, kind) in Routes)
        {
            var group = catalog.MapGroup($"/{segment}");

            group.MapGet("/", (
                    [FromQuery] string? status,
                    [FromQuery] string? search,
                    [FromQuery] int? page,
                    [FromQuery] int? pageSize,
                    [FromQuery] Guid? parentId,
                    [FromQuery] Guid? sizeGroupId,
                    ICatalogService service,
                    CancellationToken cancellationToken) =>
                    ListAsync(kind, status, search, page, pageSize, parentId, sizeGroupId, service, cancellationToken))
                .RequireAuthorization(PermissionNames.CatalogRead);

            group.MapGet("/{id:guid}", (
                    Guid id,
                    ICatalogService service,
                    HttpContext httpContext,
                    CancellationToken cancellationToken) =>
                    GetAsync(kind, id, service, httpContext, cancellationToken))
                .RequireAuthorization(PermissionNames.CatalogRead);

            group.MapPost("/", (
                    CatalogItemRequest request,
                    ICatalogService service,
                    HttpContext httpContext,
                    CancellationToken cancellationToken) =>
                    CreateAsync(kind, segment, request, service, httpContext, cancellationToken))
                .RequireAuthorization(PermissionNames.CatalogManage)
                .RequireCsrf();

            group.MapPut("/{id:guid}", (
                    Guid id,
                    CatalogItemRequest request,
                    ICatalogService service,
                    HttpContext httpContext,
                    CancellationToken cancellationToken) =>
                    UpdateAsync(kind, id, request, service, httpContext, cancellationToken))
                .RequireAuthorization(PermissionNames.CatalogManage)
                .RequireCsrf();

            group.MapPost("/{id:guid}/inactivate", (
                    Guid id,
                    ICatalogService service,
                    HttpContext httpContext,
                    CancellationToken cancellationToken) =>
                    SetActiveAsync(kind, id, false, service, httpContext, cancellationToken))
                .RequireAuthorization(PermissionNames.CatalogManage)
                .RequireCsrf();

            group.MapPost("/{id:guid}/activate", (
                    Guid id,
                    ICatalogService service,
                    HttpContext httpContext,
                    CancellationToken cancellationToken) =>
                    SetActiveAsync(kind, id, true, service, httpContext, cancellationToken))
                .RequireAuthorization(PermissionNames.CatalogManage)
                .RequireCsrf();
        }

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        CatalogKind kind,
        string? status,
        string? search,
        int? page,
        int? pageSize,
        Guid? parentId,
        Guid? sizeGroupId,
        ICatalogService service,
        CancellationToken cancellationToken)
    {
        if (!TryParseStatus(status, out var statusFilter))
        {
            return ValidationProblem("status", "El estado debe ser active, inactive o all.");
        }

        if (pageSize is < 1 or > CatalogListQuery.MaxPageSize)
        {
            return ValidationProblem(
                "pageSize",
                $"El tamaño de página debe estar entre 1 y {CatalogListQuery.MaxPageSize}.");
        }

        if (page is < 1)
        {
            return ValidationProblem("page", "La página comienza en 1.");
        }

        var result = await service.ListAsync(
            kind,
            new CatalogListQuery(
                statusFilter,
                search,
                page ?? 1,
                pageSize ?? CatalogListQuery.DefaultPageSize,
                parentId,
                sizeGroupId),
            cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> GetAsync(
        CatalogKind kind,
        Guid id,
        ICatalogService service,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var result = await service.GetAsync(kind, id, cancellationToken);
        return ToResult(result, httpContext, item => Results.Ok(item));
    }

    private static async Task<IResult> CreateAsync(
        CatalogKind kind,
        string segment,
        CatalogItemRequest request,
        ICatalogService service,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        var result = await service.CreateAsync(kind, request.ToInput(), userId, cancellationToken);
        return ToResult(
            result,
            httpContext,
            item => Results.Created($"/api/v1/catalog/{segment}/{item.Id}", item));
    }

    private static async Task<IResult> UpdateAsync(
        CatalogKind kind,
        Guid id,
        CatalogItemRequest request,
        ICatalogService service,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        if (!TryReadIfMatch(httpContext, out var expectedVersion))
        {
            return MissingIfMatch();
        }

        var result = await service.UpdateAsync(
            kind,
            id,
            expectedVersion,
            request.ToInput(),
            userId,
            cancellationToken);
        return ToResult(result, httpContext, item => Results.Ok(item));
    }

    private static async Task<IResult> SetActiveAsync(
        CatalogKind kind,
        Guid id,
        bool isActive,
        ICatalogService service,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        if (!TryReadIfMatch(httpContext, out var expectedVersion))
        {
            return MissingIfMatch();
        }

        var result = await service.SetActiveAsync(
            kind,
            id,
            expectedVersion,
            isActive,
            userId,
            cancellationToken);
        return ToResult(result, httpContext, item => Results.Ok(item));
    }

    private static IResult ToResult(
        CatalogResult<CatalogItemDto> result,
        HttpContext httpContext,
        Func<CatalogItemDto, IResult> onSuccess)
    {
        if (result.Succeeded && result.Value is { } item)
        {
            httpContext.Response.Headers.ETag = FormatETag(item.Version);
            return onSuccess(item);
        }

        var error = result.Error!;
        var status = error.Kind switch
        {
            CatalogErrorKind.Validation => StatusCodes.Status400BadRequest,
            CatalogErrorKind.NotFound => StatusCodes.Status404NotFound,
            CatalogErrorKind.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status422UnprocessableEntity,
        };
        var extensions = new Dictionary<string, object?> { ["code"] = error.Code };
        if (error.Field is not null)
        {
            extensions["errors"] = new Dictionary<string, string[]> { [error.Field] = [error.Message] };
        }

        return Results.Problem(statusCode: status, title: error.Message, extensions: extensions);
    }

    private static IResult ValidationProblem(string field, string message) =>
        Results.Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: message,
            extensions: new Dictionary<string, object?>
            {
                ["code"] = "validation_failed",
                ["errors"] = new Dictionary<string, string[]> { [field] = [message] },
            });

    private static IResult MissingIfMatch() =>
        Results.Problem(
            statusCode: StatusCodes.Status428PreconditionRequired,
            title: "Falta la versión del elemento (encabezado If-Match).",
            extensions: new Dictionary<string, object?> { ["code"] = "precondition_required" });

    private static bool TryParseStatus(string? value, out CatalogStatusFilter status)
    {
        switch (value?.Trim().ToUpperInvariant())
        {
            case null or "" or "ACTIVE":
                status = CatalogStatusFilter.Active;
                return true;
            case "INACTIVE":
                status = CatalogStatusFilter.Inactive;
                return true;
            case "ALL":
                status = CatalogStatusFilter.All;
                return true;
            default:
                status = CatalogStatusFilter.Active;
                return false;
        }
    }

    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out userId);

    /// <summary>Acepta <c>"3"</c>, <c>W/"3"</c> o <c>3</c>.</summary>
    private static bool TryReadIfMatch(HttpContext httpContext, out long version)
    {
        var value = httpContext.Request.Headers.IfMatch.ToString().Trim();
        if (value.StartsWith("W/", StringComparison.Ordinal))
        {
            value = value[2..];
        }

        return long.TryParse(
            value.Trim('"'),
            NumberStyles.None,
            CultureInfo.InvariantCulture,
            out version);
    }

    private static string FormatETag(long version) =>
        string.Create(CultureInfo.InvariantCulture, $"\"{version}\"");
}

public sealed record CatalogItemRequest(
    string? Name,
    int? SortOrder,
    bool? IsActive,
    Guid? ParentId,
    Guid? SizeGroupId,
    string? SwatchHex)
{
    public CatalogItemInput ToInput() =>
        new(Name, SortOrder, IsActive, ParentId, SizeGroupId, SwatchHex);
}
