using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace LaGanga.Api.Tests;

public sealed class AccountAccessApiTests(CatalogApiFixture fixture) : IClassFixture<CatalogApiFixture>
{
    [PostgresFact]
    public async Task EmailCodeIsSingleUseAndForcesANewPasswordBeforeAccess()
    {
        var client = fixture.CreateClient();
        using var requested = await client.PostAsJsonAsync("/api/v1/auth/code/request", new { email = CatalogApiFixture.ReaderEmail });
        Assert.Equal(HttpStatusCode.Accepted, requested.StatusCode);
        var code = fixture.EmailSender.CodeFor(CatalogApiFixture.ReaderEmail);
        Assert.NotNull(code);
        Assert.Matches("^[0-9]{6}$", code!);

        // Solicitar recuperación no puede bloquear por sí solo una sesión existente.
        using var stillAllowed = await fixture.Reader.GetAsync("/api/v1/catalog/categories");
        stillAllowed.EnsureSuccessStatusCode();

        var wrongCode = $"{(code![0] == '0' ? '1' : '0')}{code[1..]}";
        using var wrong = await client.PostAsJsonAsync("/api/v1/auth/code/verify", new { email = CatalogApiFixture.ReaderEmail, code = wrongCode });
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);

        var firstVerifier = fixture.CreateClient();
        var secondVerifier = fixture.CreateClient();
        var verificationAttempts = await Task.WhenAll(
            firstVerifier.PostAsJsonAsync("/api/v1/auth/code/verify", new { email = CatalogApiFixture.ReaderEmail, code }),
            secondVerifier.PostAsJsonAsync("/api/v1/auth/code/verify", new { email = CatalogApiFixture.ReaderEmail, code }));
        var verified = Assert.Single(verificationAttempts, response => response.StatusCode == HttpStatusCode.OK);
        var rejectedConcurrentAttempt = Assert.Single(verificationAttempts, response => response.StatusCode == HttpStatusCode.Unauthorized);
        using (rejectedConcurrentAttempt)
        {
            Assert.Equal("invalid_code", await ApiTestHelpers.ReadProblemCodeAsync(rejectedConcurrentAttempt));
        }

        var authenticatedClient = ReferenceEquals(verified, verificationAttempts[0]) ? firstVerifier : secondVerifier;
        using (verified)
        {
        Assert.Equal(HttpStatusCode.OK, verified.StatusCode);
        using var verifiedBody = JsonDocument.Parse(await verified.Content.ReadAsStringAsync());
        Assert.True(verifiedBody.RootElement.GetProperty("user").GetProperty("mustChangePassword").GetBoolean());
        var csrfCookie = verified.Headers.GetValues("Set-Cookie")
            .First(value => value.StartsWith("la_ganga_csrf=", StringComparison.Ordinal));
        var csrf = Uri.UnescapeDataString(csrfCookie.Split(';')[0]["la_ganga_csrf=".Length..]);

        using var blocked = await authenticatedClient.GetAsync("/api/v1/catalog/categories");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Equal("password_change_required", await ApiTestHelpers.ReadProblemCodeAsync(blocked));

        const string newPassword = "Nueva-contrasena-segura-2026";
        using var changeRequest = ApiTestHelpers.Build(HttpMethod.Post, "/api/v1/auth/password", csrf,
            new { currentPassword = (string?)null, newPassword });
        using var changed = await authenticatedClient.SendAsync(changeRequest);
        changed.EnsureSuccessStatusCode();
        using var changedBody = JsonDocument.Parse(await changed.Content.ReadAsStringAsync());
        Assert.False(changedBody.RootElement.GetProperty("mustChangePassword").GetBoolean());

        using var allowed = await authenticatedClient.GetAsync("/api/v1/catalog/categories");
        allowed.EnsureSuccessStatusCode();

        using var reused = await fixture.CreateClient().PostAsJsonAsync("/api/v1/auth/code/verify", new { email = CatalogApiFixture.ReaderEmail, code });
        Assert.Equal(HttpStatusCode.Unauthorized, reused.StatusCode);

        var fresh = fixture.CreateClient();
        _ = await ApiTestHelpers.LoginAsync(fresh, CatalogApiFixture.ReaderEmail, newPassword);
        }

        firstVerifier.Dispose();
        secondVerifier.Dispose();
    }
}
