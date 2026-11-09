using LaGanga.Api.Identity;
using LaGanga.Application.Common;
using LaGanga.Application.Inventory;
using LaGanga.Application.Investment;
using LaGanga.Application.Sales;
using LaGanga.Application.Settings;
using LaGanga.Domain.Identity;
using LaGanga.Domain.Inventory;
using LaGanga.Infrastructure.Inventory;
using Microsoft.AspNetCore.Mvc;

namespace LaGanga.Api.Mvp;

public static class MvpPolicies
{
    public const string SettingsRead = "policy.settings.read";
    public const string CashView = "policy.cash.view";
    public const string SaleView = "policy.sale.view";
}

public static class MvpEndpoints
{
    public static IEndpointRouteBuilder MapMvpEndpoints(this IEndpointRouteBuilder endpoints)
    {
        MapSettings(endpoints);
        MapPos(endpoints);
        MapCash(endpoints);
        MapSales(endpoints);
        MapExchanges(endpoints);
        MapProducts(endpoints);
        MapImages(endpoints);
        MapReports(endpoints);
        MapInvestment(endpoints);
        MapInventory(endpoints);
        MapAudit(endpoints);
        return endpoints;
    }

    private static void MapSettings(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/settings").WithTags("Settings");

        group.MapGet("/", async (ISettingsService service, CancellationToken ct) =>
                Results.Ok(await service.GetAsync(ct)))
            .RequireAuthorization(MvpPolicies.SettingsRead);

        group.MapPut("/", async (UpdateSettingsInput input, ISettingsService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.UpdateAsync(input, actor.UserId, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.SettingsManage)
            .RequireCsrf();
    }

    private static void MapPos(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/pos").WithTags("POS").RequireAuthorization(PermissionNames.SaleCreate);

        group.MapGet("/snapshot", async (IPosService service, CancellationToken ct) =>
            Results.Ok(await service.GetSnapshotAsync(ct)));

        group.MapPost("/sales", async (SaleRequest request, ISalesService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                if (actor is null)
                {
                    return ApiHelpers.Unauthorized401();
                }

                var result = await service.RegisterAsync(request, actor, ct);
                return result.ToHttp(value => value.AlreadyProcessed
                    ? Results.Ok(value)
                    : Results.Created($"/api/v1/sales/{value.Sale.Id}", value));
            })
            .RequireCsrf();

        group.MapPost("/discount-approvals", async (DiscountApprovalRequest request, IPosService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.CreateDiscountApprovalAsync(request, actor, ct)).ToHttp();
            })
            .RequireCsrf()
            .RequireRateLimiting(AuthConstants.LoginRateLimitPolicy);
    }

    private static void MapCash(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/cash").WithTags("Cash");

        group.MapGet("/registers", async (ICashService service, CancellationToken ct) =>
                Results.Ok(await service.ListRegistersAsync(ct)))
            .RequireAuthorization(PermissionNames.CashOperate);

        group.MapPost("/sessions", async (OpenSessionRequest request, ICashService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null
                    ? ApiHelpers.Unauthorized401()
                    : (await service.OpenAsync(request, actor, ct)).ToHttp(value => Results.Created($"/api/v1/cash/sessions/{value.Id}", value));
            })
            .RequireAuthorization(PermissionNames.CashOperate)
            .RequireCsrf();

        group.MapGet("/sessions/current", async (ICashService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.GetCurrentAsync(actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.CashOperate);

        group.MapGet("/sessions/{id:guid}/summary", async (Guid id, ICashService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.GetSummaryAsync(id, actor, ct)).ToHttp();
            })
            .RequireAuthorization(MvpPolicies.CashView);

        group.MapPost("/sessions/{id:guid}/close", async (Guid id, CloseSessionRequest request, ICashService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.CloseAsync(id, request, actor, ct)).ToHttp();
            })
            .RequireAuthorization(MvpPolicies.CashView)
            .RequireCsrf();

        group.MapGet("/sessions/{id:guid}/sales", async (Guid id, ISalesService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.ListBySessionAsync(id, actor, ct)).ToHttp();
            })
            .RequireAuthorization(MvpPolicies.SaleView);

        group.MapGet("/sessions", async (
                [FromQuery] DateOnly? from,
                [FromQuery] DateOnly? to,
                ICashService service,
                CancellationToken ct) =>
            {
                var today = BusinessTime.ToBusinessDate(DateTimeOffset.UtcNow);
                return Results.Ok(await service.ListSessionsAsync(from ?? today, to ?? from ?? today, ct));
            })
            .RequireAuthorization(PermissionNames.CashReportRead);

        group.MapGet("/consolidated", async ([FromQuery] DateOnly? date, ICashService service, CancellationToken ct) =>
                Results.Ok(await service.GetConsolidatedAsync(date ?? BusinessTime.ToBusinessDate(DateTimeOffset.UtcNow), ct)))
            .RequireAuthorization(PermissionNames.CashReportRead);
    }

    private static void MapSales(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/sales").WithTags("Sales");

        group.MapGet("/", async (
                [FromQuery] DateOnly? from,
                [FromQuery] DateOnly? to,
                [FromQuery] Guid? sessionId,
                [FromQuery] string? status,
                [FromQuery] bool? needsReview,
                [FromQuery] string? number,
                [FromQuery] int? page,
                [FromQuery] int? pageSize,
                ISalesService service,
                CancellationToken ct) =>
            {
                var (p, size) = Paging.Normalize(page, pageSize);
                return Results.Ok(await service.ListAsync(new SaleListQuery(from, to, sessionId, status, needsReview, number, p, size), ct));
            })
            .RequireAuthorization(PermissionNames.SaleRead);

        group.MapGet("/{id:guid}", async (Guid id, ISalesService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.GetAsync(id, actor, ct)).ToHttp();
            })
            .RequireAuthorization(MvpPolicies.SaleView);

        group.MapPost("/{id:guid}/void", async (Guid id, VoidSaleRequest request, ISalesService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.VoidAsync(id, request, actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.SaleVoid)
            .RequireCsrf();

        group.MapPost("/{id:guid}/resolve-review", async (Guid id, ResolveReviewRequest request, ISalesService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.ResolveReviewAsync(id, request, actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.SaleVoid)
            .RequireCsrf();
    }

    private static void MapExchanges(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/exchanges").WithTags("Exchanges").RequireAuthorization(PermissionNames.SaleExchange);

        group.MapGet("/lookup", async ([FromQuery] string? number, IExchangeService service, CancellationToken ct) =>
            (await service.LookupAsync(number, ct)).ToHttp());

        group.MapPost("/", async (ExchangeRequest request, IExchangeService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                if (actor is null)
                {
                    return ApiHelpers.Unauthorized401();
                }

                var result = await service.RegisterAsync(request, actor, ct);
                return result.ToHttp(value => value.AlreadyProcessed
                    ? Results.Ok(value)
                    : Results.Created($"/api/v1/exchanges/{value.Exchange.Id}", value));
            })
            .RequireCsrf();
    }

    private static void MapProducts(IEndpointRouteBuilder endpoints)
    {
        var products = endpoints.MapGroup("/api/v1/products").WithTags("Products");

        products.MapGet("/", async (
                [FromQuery] string? search,
                [FromQuery] Guid? categoryId,
                [FromQuery] Guid? brandId,
                [FromQuery] string? status,
                [FromQuery] int? page,
                [FromQuery] int? pageSize,
                IProductService service,
                CancellationToken ct) =>
            {
                var (p, size) = Paging.Normalize(page, pageSize);
                return Results.Ok(await service.ListAsync(new ProductListQuery(search, categoryId, brandId, status, p, size), ct));
            })
            .RequireAuthorization(PermissionNames.ProductRead);

        products.MapGet("/{id:guid}", async (Guid id, IProductService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null
                    ? ApiHelpers.Unauthorized401()
                    : (await service.GetAsync(id, actor, ct)).ToHttp(detail =>
                    {
                        http.Response.Headers.ETag = ApiHelpers.ETag(detail.Version);
                        return Results.Ok(detail);
                    });
            })
            .RequireAuthorization(PermissionNames.ProductRead);

        products.MapPost("/", async (CreateProductInput input, IProductService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null
                    ? ApiHelpers.Unauthorized401()
                    : (await service.CreateAsync(input, actor, ct)).ToHttp(detail => Results.Created($"/api/v1/products/{detail.Id}", detail));
            })
            .RequireAuthorization(PermissionNames.ProductCreate)
            .RequireCsrf();

        products.MapPut("/{id:guid}", async (Guid id, UpdateProductInput input, IProductService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                if (actor is null)
                {
                    return ApiHelpers.Unauthorized401();
                }

                return http.TryReadIfMatch(out var version)
                    ? (await service.UpdateAsync(id, version, input, actor, ct)).ToHttp()
                    : ApiHelpers.MissingIfMatch();
            })
            .RequireAuthorization(PermissionNames.ProductEdit)
            .RequireCsrf();

        products.MapPost("/{id:guid}/variants", async (Guid id, NewVariantInput input, IProductService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null
                    ? ApiHelpers.Unauthorized401()
                    : (await service.AddVariantAsync(id, input, actor, ct)).ToHttp(detail => Results.Created($"/api/v1/products/{detail.Id}", detail));
            })
            .RequireAuthorization(PermissionNames.ProductEdit)
            .RequireCsrf();

        products.MapPost("/import", async (ImportRequest request, IProductService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.ImportAsync(request, actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.ProductCreate)
            .RequireCsrf();

        var variants = endpoints.MapGroup("/api/v1/variants").WithTags("Products");

        variants.MapPut("/{id:guid}", async (Guid id, UpdateVariantInput input, IProductService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                if (actor is null)
                {
                    return ApiHelpers.Unauthorized401();
                }

                return http.TryReadIfMatch(out var version)
                    ? (await service.UpdateVariantAsync(id, version, input, actor, ct)).ToHttp()
                    : ApiHelpers.MissingIfMatch();
            })
            .RequireAuthorization(PermissionNames.ProductEdit)
            .RequireCsrf();

        variants.MapGet("/by-barcode/{barcode}", async (string barcode, IProductService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.FindByBarcodeAsync(barcode, actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.ProductRead);
    }

    private static void MapImages(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/products/{id:guid}/images").WithTags("Product images");

        // La protección CSRF de la API va en el encabezado X-CSRF-Token; la de formularios de ASP.NET no aplica.
        group.MapPost("/", async (Guid id, HttpContext http, IProductImageService service, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                if (actor is null)
                {
                    return ApiHelpers.Unauthorized401();
                }

                if (!http.Request.HasFormContentType)
                {
                    return ApiHelpers.BadRequest("file", "Enviá la imagen como formulario (multipart/form-data).");
                }

                var form = await http.Request.ReadFormAsync(ct);
                var file = form.Files.GetFile("file");
                var thumb = form.Files.GetFile("thumb");
                if (file is null || thumb is null)
                {
                    return ApiHelpers.BadRequest("file", "Faltan los campos «file» y «thumb».");
                }

                if (file.Length > ProductImageService.MaxImageBytes || thumb.Length > ProductImageService.MaxThumbBytes)
                {
                    return Results.Problem(
                        statusCode: StatusCodes.Status422UnprocessableEntity,
                        title: "La imagen es demasiado pesada.",
                        extensions: new Dictionary<string, object?> { ["code"] = "invalid_image" });
                }

                var image = await ReadAllAsync(file, ct);
                var thumbnail = await ReadAllAsync(thumb, ct);
                return (await service.AddAsync(id, image, thumbnail, actor, ct))
                    .ToHttp(value => Results.Created(value.Url, value));
            })
            .RequireAuthorization(PermissionNames.ProductImagesManage)
            .RequireCsrf()
            .DisableAntiforgery();

        group.MapPut("/order", async (Guid id, ReorderImagesRequest request, IProductImageService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.ReorderAsync(id, request, actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.ProductImagesManage)
            .RequireCsrf();

        group.MapDelete("/{imageId:guid}", async (Guid id, Guid imageId, IProductImageService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null
                    ? ApiHelpers.Unauthorized401()
                    : (await service.DeleteAsync(id, imageId, actor, ct)).ToHttp(_ => Results.NoContent());
            })
            .RequireAuthorization(PermissionNames.ProductImagesManage)
            .RequireCsrf();

        // Las imágenes no cambian nunca para un mismo nombre: el navegador y el POS las guardan sin vencimiento.
        endpoints.MapGet("/api/v1/media/{fileName}", (string fileName, IImageStorage storage, HttpContext http) =>
            {
                var stream = LocalImageStorage.IsValidName(fileName) ? storage.OpenRead(fileName) : null;
                if (stream is null)
                {
                    return Results.NotFound();
                }

                http.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
                http.Response.Headers["X-Content-Type-Options"] = "nosniff";
                return Results.Stream(stream, ImageSniffer.ContentType(Path.GetExtension(fileName).TrimStart('.')));
            })
            .WithTags("Product images")
            .RequireAuthorization();
    }

    private static async Task<byte[]> ReadAllAsync(IFormFile file, CancellationToken cancellationToken)
    {
        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream((int)file.Length);
        await stream.CopyToAsync(buffer, cancellationToken);
        return buffer.ToArray();
    }

    private static void MapInvestment(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/investment").WithTags("Investment");

        group.MapGet("/partners", async ([FromQuery] string? status, IInvestmentService service, CancellationToken ct) =>
                Results.Ok(await service.ListPartnersAsync(status, ct)))
            .RequireAuthorization(PermissionNames.InvestmentRead);

        group.MapPost("/partners", async (PartnerInput input, IInvestmentService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null
                    ? ApiHelpers.Unauthorized401()
                    : (await service.CreatePartnerAsync(input, actor, ct)).ToHttp(partner => Results.Created($"/api/v1/investment/partners/{partner.Id}", partner));
            })
            .RequireAuthorization(PermissionNames.InvestmentManage)
            .RequireCsrf();

        group.MapPut("/partners/{id:guid}", async (Guid id, PartnerInput input, IInvestmentService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.UpdatePartnerAsync(id, input, actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.InvestmentManage)
            .RequireCsrf();

        group.MapGet("/summary", async ([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, IInvestmentService service, CancellationToken ct) =>
                Results.Ok(await service.GetSummaryAsync(from, to, ct)))
            .RequireAuthorization(PermissionNames.InvestmentRead);

        group.MapGet("/breakdown", async (
                [FromQuery] string? partnerId,
                [FromQuery] DateOnly? from,
                [FromQuery] DateOnly? to,
                IInvestmentService service,
                CancellationToken ct) =>
                Results.Ok(await service.GetBreakdownAsync(partnerId, from, to, ct)))
            .RequireAuthorization(PermissionNames.InvestmentRead);

        group.MapGet("/lots", async (
                [FromQuery] string? partnerId,
                [FromQuery] string? search,
                [FromQuery] bool? onlyWithStock,
                [FromQuery] DateOnly? from,
                [FromQuery] DateOnly? to,
                [FromQuery] int? page,
                [FromQuery] int? pageSize,
                IInvestmentService service,
                CancellationToken ct) =>
            {
                var (p, size) = Paging.Normalize(page, pageSize);
                return Results.Ok(await service.ListLotsAsync(new LotQuery(partnerId, search, onlyWithStock ?? false, from, to, p, size), ct));
            })
            .RequireAuthorization(PermissionNames.InvestmentRead);

        group.MapPut("/lots/{id:guid}", async (Guid id, UpdateLotInput input, IInvestmentService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.UpdateLotAsync(id, input, actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.InvestmentManage)
            .RequireCsrf();
    }

    private static void MapReports(IEndpointRouteBuilder endpoints)
    {
        const string xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        var group = endpoints.MapGroup("/api/v1/reports").WithTags("Reports");

        static IResult File(ServiceResult<ReportFile> result) =>
            result.ToHttp(report => Results.File(report.Content, xlsx, report.FileName));

        static (DateOnly From, DateOnly To) Range(DateOnly? from, DateOnly? to)
        {
            var today = BusinessTime.ToBusinessDate(DateTimeOffset.UtcNow);
            return (from ?? to ?? today, to ?? from ?? today);
        }

        group.MapGet("/sales", async ([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, IReportService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                var (start, end) = Range(from, to);
                return actor is null ? ApiHelpers.Unauthorized401() : File(await service.SalesAsync(start, end, actor, ct));
            })
            .RequireAuthorization(PermissionNames.SaleRead);

        group.MapGet("/inventory", async (IReportService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : File(await service.InventoryAsync(actor, ct));
            })
            .RequireAuthorization(PermissionNames.InventoryRead);

        group.MapGet("/movements", async ([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, IReportService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                var (start, end) = Range(from, to);
                return actor is null ? ApiHelpers.Unauthorized401() : File(await service.MovementsAsync(start, end, actor, ct));
            })
            .RequireAuthorization(PermissionNames.InventoryKardexRead);

        group.MapGet("/investment", async ([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, IReportService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                var (start, end) = Range(from, to);
                return actor is null ? ApiHelpers.Unauthorized401() : File(await service.InvestmentAsync(start, end, actor, ct));
            })
            .RequireAuthorization(PermissionNames.InvestmentRead);

        group.MapGet("/cash", async ([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, IReportService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                var (start, end) = Range(from, to);
                return actor is null ? ApiHelpers.Unauthorized401() : File(await service.CashAsync(start, end, actor, ct));
            })
            .RequireAuthorization(PermissionNames.CashReportRead);
    }

    private static void MapInventory(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/inventory").WithTags("Inventory");

        group.MapGet("/summary", async (IInventoryService service, CancellationToken ct) =>
                Results.Ok(await service.GetSummaryAsync(ct)))
            .RequireAuthorization(PermissionNames.InventoryRead);

        group.MapGet("/", async (
                [FromQuery] string? search,
                [FromQuery] string? filter,
                [FromQuery] string? partnerId,
                [FromQuery] int? page,
                [FromQuery] int? pageSize,
                IInventoryService service,
                HttpContext http,
                CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                if (actor is null)
                {
                    return ApiHelpers.Unauthorized401();
                }

                var (p, size) = Paging.Normalize(page, pageSize);
                return Results.Ok(await service.ListAsync(new InventoryQuery(search, filter, p, size, partnerId), actor, ct));
            })
            .RequireAuthorization(PermissionNames.InventoryRead);

        group.MapGet("/variants/{id:guid}/kardex", async (
                Guid id,
                [FromQuery] int? page,
                [FromQuery] int? pageSize,
                IInventoryService service,
                CancellationToken ct) =>
            {
                var (p, size) = Paging.Normalize(page, pageSize);
                return (await service.GetKardexAsync(id, p, size, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.InventoryKardexRead);

        group.MapPost("/adjustments", async (AdjustmentInput input, IInventoryService service, HttpContext http, CancellationToken ct) =>
            {
                var actor = http.User.GetActor();
                return actor is null ? ApiHelpers.Unauthorized401() : (await service.AdjustAsync(input, actor, ct)).ToHttp();
            })
            .RequireAuthorization(PermissionNames.InventoryAdjust)
            .RequireCsrf();
    }

    private static void MapAudit(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/audit", async (
                [FromQuery] string? entityType,
                [FromQuery] Guid? userId,
                [FromQuery] DateOnly? from,
                [FromQuery] DateOnly? to,
                [FromQuery] int? page,
                [FromQuery] int? pageSize,
                IAuditQueryService service,
                CancellationToken ct) =>
            {
                var (p, size) = Paging.Normalize(page, pageSize);
                return Results.Ok(await service.ListAsync(new AuditQuery(entityType, userId, from, to, p, size), ct));
            })
            .WithTags("Audit")
            .RequireAuthorization(PermissionNames.AuditRead);
    }
}
