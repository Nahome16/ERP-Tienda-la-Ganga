namespace LaGanga.Application.Common;

public enum ServiceErrorKind
{
    Validation,
    NotFound,
    Conflict,
    Forbidden,
    Unauthorized,
    Unprocessable,
}

public sealed record ServiceError(ServiceErrorKind Kind, string Code, string Message, string? Field = null);

/// <summary>Resultado de un caso de uso: un valor o un error con código estable.</summary>
public sealed class ServiceResult<T>
{
    internal ServiceResult(T? value, ServiceError? error)
    {
        Value = value;
        Error = error;
    }

    public T? Value { get; }

    public ServiceError? Error { get; }

    public bool Succeeded => Error is null;
}

public static class Result
{
    public static ServiceResult<T> Ok<T>(T value) => new(value, null);

    public static ServiceResult<T> Fail<T>(ServiceError error) => new(default, error);

    public static ServiceResult<T> Fail<T>(ServiceErrorKind kind, string code, string message, string? field = null) =>
        new(default, new ServiceError(kind, code, message, field));
}

public sealed record PageResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount, int TotalPages);

public static class Paging
{
    public const int MaxPageSize = 100;
    public const int DefaultPageSize = 25;

    public static PageResult<T> Create<T>(IReadOnlyList<T> items, int page, int pageSize, int totalCount) =>
        new(items, page, pageSize, totalCount, pageSize == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize));

    public static (int Page, int PageSize) Normalize(int? page, int? pageSize) =>
        (Math.Max(page ?? 1, 1), Math.Clamp(pageSize ?? DefaultPageSize, 1, MaxPageSize));
}
