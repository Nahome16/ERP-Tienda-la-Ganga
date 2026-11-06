using LaGanga.Application;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHealthChecks();

var app = builder.Build();

app.MapGet("/api/health", () =>
    Results.Ok(SystemStatus.Healthy(TimeProvider.System.GetUtcNow())))
    .WithName("GetSystemStatus");

app.MapHealthChecks("/health");

app.Run();

public partial class Program;
