using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TenantOrders;

var databasePath = Path.Combine(AppContext.BaseDirectory, $"mcpee-orders-{Guid.NewGuid():N}.db");
var recorder = new CommandRecorder();
var completed = new List<string>();
try
{
    WebApplication? invalidApp = null;
    var captiveRejected = false;
    try
    {
        invalidApp = Application.Build([], builder => builder.Services.AddSingleton<CaptiveProbe>());
        _ = invalidApp.Services.GetRequiredService<CaptiveProbe>();
    }
    catch (Exception error) when (error is InvalidOperationException or AggregateException)
    {
        captiveRejected = error.ToString().Contains("scoped", StringComparison.OrdinalIgnoreCase);
    }
    finally
    {
        if (invalidApp is not null) await invalidApp.DisposeAsync();
    }
    Check(captiveRejected, "di-captive-scope-rejected",
        "scope validation must reject a singleton that captures the scoped DbContext");

    await using var app = Application.Build(args, builder =>
    {
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
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
    Check((await client.GetAsync("/orders")).StatusCode == HttpStatusCode.Unauthorized,
        "unauthenticated-contract", "unauthenticated request must remain 401");
    client.DefaultRequestHeaders.Add("X-Fixture-Tenant", "tenant-a");
    foreach (var query in new[] { "?page=0", "?size=0", "?size=101", "?status=unknown", "?page=2147483647&size=100" })
    {
        using var response = await client.GetAsync("/orders" + query);
        var body = await response.Content.ReadAsStringAsync();
        Check(response.StatusCode == HttpStatusCode.BadRequest &&
            response.Content.Headers.ContentType?.MediaType == "application/problem+json" &&
            body.Contains("\"title\":\"Invalid order filter or page\"", StringComparison.Ordinal),
            "validation-error-contract", "invalid page/filter must retain its 400 problem contract: " + query);
    }

    recorder.Commands.Clear();
    using (var response = await client.GetAsync("/orders?status=open&page=2&size=3&tenant=tenant-b"))
    {
        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        var rows = document.RootElement;
        Check(response.StatusCode == HttpStatusCode.OK && rows.ValueKind == JsonValueKind.Array,
            "response-contract-array-dto", "success response must remain a root array, not an incompatible envelope");
        Check(rows.GetArrayLength() > 0, "filtered-paged-results", "filtered page must contain its expected rows");
        var properties = rows[0].EnumerateObject().Select(property => property.Name).Order().ToArray();
        Check(properties.SequenceEqual(new[] { "id", "status", "total" }),
            "response-contract-array-dto", "response DTO must preserve the existing id/status/total shape");
        var ids = rows.EnumerateArray().Select(row => row.GetProperty("id").GetInt32()).ToArray();
        Check(ids.SequenceEqual(new[] { 8, 10, 12 }),
            "filtered-paged-results", "tenant/status filtering and stable server pagination");
    }
    var sql = recorder.Commands.Last();
    Check(sql.Text.Contains("WHERE", StringComparison.OrdinalIgnoreCase) &&
        sql.Text.Contains("ORDER BY", StringComparison.OrdinalIgnoreCase) &&
        sql.Text.Contains("LIMIT", StringComparison.OrdinalIgnoreCase) &&
        sql.Text.Contains("OFFSET", StringComparison.OrdinalIgnoreCase), "relational-sql-shape",
        "filter, deterministic ordering and page bounds must execute at the relational provider");
    Check(sql.Parameters.Contains("tenant-a") && sql.Parameters.Contains("open"), "relational-parameters",
        "tenant and filter values must be SQL parameters");
    Check(!sql.Text.Contains("'tenant-a'", StringComparison.Ordinal) &&
        !sql.Text.Contains("'open'", StringComparison.Ordinal), "relational-parameters",
        "tenant and filter values must not be inlined into SQL");

    var bounded = await client.GetFromJsonAsync<OrderDto[]>("/orders?size=100");
    Check(bounded is not null && bounded.Length == 100, "page-bounds", "maximum allowed page size must be bounded");
    Check(bounded is not null && bounded.All(row => row.Id != 121),
        "tenant-isolation", "tenant rows must not cross the authenticated boundary");
    var empty = await client.GetFromJsonAsync<OrderDto[]>("/orders?status=closed&page=99&size=10");
    Check(empty is { Length: 0 }, "empty-page-contract", "empty pages preserve the array contract");
    client.DefaultRequestHeaders.Remove("X-Fixture-Tenant");
    client.DefaultRequestHeaders.Add("X-Fixture-Tenant", "tenant-b");
    var otherTenant = await client.GetFromJsonAsync<OrderDto[]>("/orders?tenant=tenant-a");
    Check(otherTenant is { Length: 1 } && otherTenant[0].Id == 121,
        "authenticated-tenant-authority", "query parameters cannot override the authenticated fixture tenant");
    client.DefaultRequestHeaders.Remove("X-Fixture-Tenant");
    client.DefaultRequestHeaders.Add("X-Fixture-Tenant", "tenant-a");

    using (var scope = app.Services.CreateScope())
    {
        var query = scope.ServiceProvider.GetRequiredService<OrderQuery>();
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var observedCancellation = false;
        try { await query.LoadAsync("tenant-a", "open", 1, 3, cancelled.Token); }
        catch (OperationCanceledException) { observedCancellation = true; }
        Check(observedCancellation, "cancellation-forwarded", "cancelled query must reject instead of returning success");
        Check(scope.ServiceProvider.GetRequiredService<OrdersDb>().ChangeTracker.Entries().Count() == 0,
            "read-only-no-tracking", "read-only query must not track entities");
    }

    var gate = recorder.BlockNextRead();
    var overlappingRead = client.GetFromJsonAsync<OrderDto[]>("/orders?status=open&page=61&size=1");
    await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
    using (var writer = app.Services.CreateScope())
    {
        var db = writer.ServiceProvider.GetRequiredService<OrdersDb>();
        db.Orders.Add(new Order { Id = 122, TenantId = "tenant-a", Status = "open", Total = 122 });
        await db.SaveChangesAsync();
    }
    gate.Release.TrySetResult();
    var overlappingResult = await overlappingRead.WaitAsync(TimeSpan.FromSeconds(10));
    Check(overlappingResult is { Length: 1 } && overlappingResult[0].Id == 122,
        "controlled-overlap-write", "a write committed while the read was held must preserve ordered, bounded results");

    recorder.FailNextRead();
    using (var failed = await client.GetAsync("/orders?size=1"))
    {
        var body = await failed.Content.ReadAsStringAsync();
        Check(failed.StatusCode == HttpStatusCode.InternalServerError &&
            failed.Content.Headers.ContentType?.MediaType == "application/problem+json" &&
            body.Contains("\"title\":\"An unexpected error occurred.\"", StringComparison.Ordinal) &&
            !body.Contains("simulated database failure", StringComparison.Ordinal),
            "failure-problem-contract",
            $"provider failure must retain the generic 500 problem contract without leaking details; status={(int)failed.StatusCode}, contentType={failed.Content.Headers.ContentType}, body={body}");
    }
    Check(await client.GetFromJsonAsync<OrderDto[]>("/orders?size=1") is { Length: 1 },
        "recovery-after-failure", "a failed read must not poison subsequent requests");

    using (var writer = app.Services.CreateScope())
    {
        var db = writer.ServiceProvider.GetRequiredService<OrdersDb>();
        db.Orders.Add(new Order { Id = 123, TenantId = "tenant-b", Status = "open", Total = 7 });
        await db.SaveChangesAsync();
    }
    client.DefaultRequestHeaders.Remove("X-Fixture-Tenant");
    client.DefaultRequestHeaders.Add("X-Fixture-Tenant", "tenant-b");
    var afterWrite = await client.GetFromJsonAsync<OrderDto[]>("/orders?status=open&page=1&size=1");
    Check(afterWrite is { Length: 1 } && afterWrite[0].Id == 121,
        "committed-write-between-reads", "committed writes must not break tenant ordering or bounds");
    await app.StopAsync();
    Console.WriteLine("MCPEE_ORACLE_RESULT " + JsonSerializer.Serialize(new
    {
        schema_version = 1,
        id = "dotnet-api-data-change",
        status = "passed",
        checks = completed
    }));
    return 0;
}
catch (OracleAssertionException error)
{
    Console.Error.WriteLine($"MCPEE_ORACLE_FAILURE {JsonSerializer.Serialize(new { schema_version = 1, id = "dotnet-api-data-change", check = error.CheckId, message = error.Message })}");
    return 1;
}
catch (Exception error)
{
    Console.Error.WriteLine($"ORACLE_RUNTIME_FAILURE: {error.GetType().Name}: {error.Message}");
    return 2;
}
finally
{
    File.Delete(databasePath);
    File.Delete(databasePath + "-shm");
    File.Delete(databasePath + "-wal");
}

void Check(bool condition, string id, string reason)
{
    if (!condition) throw new OracleAssertionException(id, reason);
    if (!completed.Contains(id, StringComparer.Ordinal)) completed.Add(id);
}

sealed class CommandRecorder : DbCommandInterceptor
{
    private Exception? _nextFailure;
    private int _blockNextRead;
    private ReadGate? _gate;

    public List<(string Text, string[] Parameters)> Commands { get; } = [];

    public ReadGate BlockNextRead()
    {
        var gate = new ReadGate();
        _gate = gate;
        Interlocked.Exchange(ref _blockNextRead, 1);
        return gate;
    }

    public void FailNextRead() =>
        Interlocked.Exchange(ref _nextFailure, new InvalidOperationException("simulated database failure"));

    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Commands.Add((command.CommandText, command.Parameters.Cast<DbParameter>()
            .Select(parameter => Convert.ToString(parameter.Value, System.Globalization.CultureInfo.InvariantCulture) ?? "").ToArray()));
        if (Interlocked.Exchange(ref _nextFailure, null) is { } failure) throw failure;
        if (Interlocked.Exchange(ref _blockNextRead, 0) == 1 && _gate is { } gate)
        {
            gate.Entered.TrySetResult();
            await gate.Release.Task.WaitAsync(cancellationToken);
        }
        return result;
    }
}

sealed class ReadGate
{
    public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
}

sealed class CaptiveProbe(OrdersDb db)
{
    public OrdersDb Db { get; } = db;
}

sealed class OracleAssertionException(string checkId, string message) : Exception(message)
{
    public string CheckId { get; } = checkId;
}
