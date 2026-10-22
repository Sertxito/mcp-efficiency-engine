using Microsoft.EntityFrameworkCore;

namespace TenantOrders;

public static class Application
{
    public static WebApplication Build(string[] args, Action<WebApplicationBuilder>? configure = null)
    {
        var builder = WebApplication.CreateBuilder(args);
        configure?.Invoke(builder);
        builder.Host.UseDefaultServiceProvider(options =>
        {
            options.ValidateScopes = true;
            options.ValidateOnBuild = true;
        });
        builder.Services.AddDbContext<OrdersDb>(options =>
            options.UseSqlite(builder.Configuration.GetConnectionString("Orders") ?? "Data Source=orders.db"));
        builder.Services.AddScoped<OrderQuery>();
        var app = builder.Build();
        app.MapGet("/orders", async (HttpContext http, OrderQuery query, string? status,
            int page = 1, int size = 20, CancellationToken ct = default) =>
        {
            // Synthetic authentication boundary; never use a caller header as real authentication.
            var tenant = http.Request.Headers["X-Fixture-Tenant"].ToString();
            if (tenant is not ("tenant-a" or "tenant-b"))
                return Results.Unauthorized();
            if (page < 1 || size is < 1 or > 100 || (long)(page - 1) * size > int.MaxValue ||
                (status is not null && status is not ("open" or "closed")))
                return Results.Problem(statusCode: 400, title: "Invalid order filter or page");
            return Results.Ok(await query.LoadAsync(tenant, status, page, size, ct));
        });
        return app;
    }

    public static async Task Main(string[] args)
    {
        await using var app = Build(args);
        await app.RunAsync();
    }
}

public sealed class OrdersDb(DbContextOptions<OrdersDb> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();
}

public sealed class Order
{
    public int Id { get; set; }
    public required string TenantId { get; set; }
    public required string Status { get; set; }
    public decimal Total { get; set; }
}

public sealed record OrderDto(int Id, string Status, decimal Total);
