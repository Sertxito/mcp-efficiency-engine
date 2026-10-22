using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using TenantOrders;

var databasePath = Path.Combine(Path.GetTempPath(), $"mcpee-orders-{Guid.NewGuid():N}.db");
var recorder = new CommandRecorder();
try
{
    await using var app = Application.Build([], builder =>
    {
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:Orders"] = $"Data Source={databasePath};Pooling=False";
        builder.Services.AddDbContext<OrdersDb>(options => options.AddInterceptors(recorder));
    });
    using (var scope = app.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<OrdersDb>();
        await db.Database.EnsureCreatedAsync();
        for (var id = 1; id <= 120; id++)
            db.Orders.Add(new Order { Id = id, TenantId = "tenant-a", Status = id % 2 == 0 ? "open" : "closed", Total = id });
        db.Orders.Add(new Order { Id = 121, TenantId = "tenant-b", Status = "open", Total = 999 });
        await db.SaveChangesAsync();
    }
    await app.StartAsync();
    using var client = app.GetTestClient();
    Require((await client.GetAsync("/orders")).StatusCode == HttpStatusCode.Unauthorized, "unauthenticated request must be rejected");
    client.DefaultRequestHeaders.Add("X-Fixture-Tenant", "tenant-a");
    foreach (var query in new[] { "?page=0", "?size=0", "?size=101", "?status=unknown", "?page=2147483647&size=100" })
        Require((await client.GetAsync("/orders" + query)).StatusCode == HttpStatusCode.BadRequest, "invalid page/filter must return 400: " + query);

    recorder.Commands.Clear();
    var first = await client.GetFromJsonAsync<OrderDto[]>("/orders?status=open&page=2&size=3&tenant=tenant-b");
    Require(first is not null && first.Select(row => row.Id).SequenceEqual(new[] { 8, 10, 12 }), "tenant/status filtering and stable server pagination");
    var sql = recorder.Commands.Last();
    Require(sql.Text.Contains("WHERE", StringComparison.OrdinalIgnoreCase) &&
        sql.Text.Contains("ORDER BY", StringComparison.OrdinalIgnoreCase) &&
        sql.Text.Contains("LIMIT", StringComparison.OrdinalIgnoreCase) &&
        sql.Text.Contains("OFFSET", StringComparison.OrdinalIgnoreCase), "filter, ordering and bounds must execute at relational provider");
    Require(sql.Parameters.Contains("tenant-a") && sql.Parameters.Contains("open"), "tenant and filter values must be parameters");
    Require(!sql.Text.Contains("'tenant-a'", StringComparison.Ordinal) && !sql.Text.Contains("'open'", StringComparison.Ordinal), "do not inline tenant/filter input into SQL");

    var bounded = await client.GetFromJsonAsync<OrderDto[]>("/orders?size=100");
    Require(bounded is { Length: 100 } && bounded.All(row => row.Id != 121), "page bound and cross-tenant isolation");
    var empty = await client.GetFromJsonAsync<OrderDto[]>("/orders?status=closed&page=99&size=10");
    Require(empty is { Length: 0 }, "empty page preserves array contract");
    client.DefaultRequestHeaders.Remove("X-Fixture-Tenant");
    client.DefaultRequestHeaders.Add("X-Fixture-Tenant", "tenant-b");
    var otherTenant = await client.GetFromJsonAsync<OrderDto[]>("/orders?tenant=tenant-a");
    Require(otherTenant is { Length: 1 } && otherTenant[0].Id == 121, "caller cannot override authenticated fixture tenant");

    using (var scope = app.Services.CreateScope())
    {
        var query = scope.ServiceProvider.GetRequiredService<OrderQuery>();
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var observedCancellation = false;
        try { await query.LoadAsync("tenant-a", "open", 1, 3, cancelled.Token); }
        catch (OperationCanceledException) { observedCancellation = true; }
        Require(observedCancellation, "cancelled query must reject instead of returning success");
        Require(scope.ServiceProvider.GetRequiredService<OrdersDb>().ChangeTracker.Entries().Count() == 0,
            "read-only endpoint must not track returned entities");
    }
    using (var writer = app.Services.CreateScope())
    {
        var db = writer.ServiceProvider.GetRequiredService<OrdersDb>();
        db.Orders.Add(new Order { Id = 122, TenantId = "tenant-b", Status = "open", Total = 7 });
        await db.SaveChangesAsync();
    }
    var afterWrite = await client.GetFromJsonAsync<OrderDto[]>("/orders?status=open&page=1&size=1");
    Require(afterWrite is { Length: 1 } && afterWrite[0].Id == 121, "committed write must not break tenant ordering or bounds");
    await app.StopAsync();
    Console.WriteLine("PASS: real ASP.NET startup, SQLite SQL/parameters, tenant/DTO/filter/page/error/cancellation/read-only and committed-write checks");
}
finally
{
    File.Delete(databasePath);
    File.Delete(databasePath + "-shm");
    File.Delete(databasePath + "-wal");
}

static void Require(bool condition, string reason)
{
    if (!condition) throw new InvalidOperationException("FAIL: " + reason);
}

sealed class CommandRecorder : DbCommandInterceptor
{
    public List<(string Text, string[] Parameters)> Commands { get; } = [];

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Commands.Add((command.CommandText, command.Parameters.Cast<DbParameter>()
            .Select(parameter => Convert.ToString(parameter.Value, System.Globalization.CultureInfo.InvariantCulture) ?? "").ToArray()));
        return ValueTask.FromResult(result);
    }
}
