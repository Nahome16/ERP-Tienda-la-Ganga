using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;

namespace LaGanga.Api.Tests;

public sealed record CatalogItemResponse(
    Guid Id,
    string Name,
    bool IsActive,
    int SortOrder,
    long Version,
    Guid? ParentId,
    Guid? SizeGroupId,
    string? SwatchHex);

public sealed record CatalogPageResponse(
    IReadOnlyList<CatalogItemResponse> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages);

public static class ApiTestHelpers
{
    private const string CsrfCookiePrefix = "la_ganga_csrf=";

    /// <summary>Inicia sesión y devuelve el token CSRF emitido.</summary>
    public static async Task<string> LoginAsync(HttpClient client, string username, string password)
    {
        ArgumentNullException.ThrowIfNull(client);

        using var request = Build(HttpMethod.Post, "/api/v1/auth/login", null, new { username, password });
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var cookie = response.Headers.GetValues("Set-Cookie")
            .First(value => value.StartsWith(CsrfCookiePrefix, StringComparison.Ordinal));
        var encoded = cookie.Split(';')[0][CsrfCookiePrefix.Length..];
        return Uri.UnescapeDataString(encoded);
    }

    public static HttpRequestMessage Build(
        HttpMethod method,
        string url,
        string? csrfToken,
        object? body = null,
        long? ifMatch = null)
    {
        var request = new HttpRequestMessage(method, new Uri(url, UriKind.Relative));
        if (csrfToken is not null)
        {
            request.Headers.Add("X-CSRF-Token", csrfToken);
        }

        if (ifMatch is { } version)
        {
            request.Headers.TryAddWithoutValidation(
                "If-Match",
                string.Create(CultureInfo.InvariantCulture, $"\"{version}\""));
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return request;
    }

    public static async Task<string?> ReadProblemCodeAsync(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }
}
