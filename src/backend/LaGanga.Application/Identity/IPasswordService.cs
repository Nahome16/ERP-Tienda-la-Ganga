using LaGanga.Domain.Identity;

namespace LaGanga.Application.Identity;

public interface IPasswordService
{
    string HashPassword(UserAccount user, string password);

    bool VerifyPassword(UserAccount user, string passwordHash, string providedPassword);
}
