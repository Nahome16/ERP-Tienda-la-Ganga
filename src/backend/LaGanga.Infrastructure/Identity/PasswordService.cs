using LaGanga.Application.Identity;
using LaGanga.Domain.Identity;
using Microsoft.AspNetCore.Identity;

namespace LaGanga.Infrastructure.Identity;

public sealed class PasswordService(IPasswordHasher<UserAccount> passwordHasher) : IPasswordService
{
    public string HashPassword(UserAccount user, string password) =>
        passwordHasher.HashPassword(user, password);

    public bool VerifyPassword(UserAccount user, string passwordHash, string providedPassword) =>
        passwordHasher.VerifyHashedPassword(user, passwordHash, providedPassword) !=
        PasswordVerificationResult.Failed;
}
