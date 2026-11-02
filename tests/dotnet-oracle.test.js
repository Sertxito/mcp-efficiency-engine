"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "templates", "specialist-acceptance", "dotnet-api-data-change");
const referenceQuery = `using Microsoft.EntityFrameworkCore;

namespace TenantOrders;

public sealed class OrderQuery(OrdersDb db)
{
    public async Task<IReadOnlyList<OrderDto>> LoadAsync(
        string tenant, string? status, int page, int size, CancellationToken ct)
    {
        var query = db.Orders.AsNoTracking().Where(order => order.TenantId == tenant);
        if (status is not null)
            query = query.Where(order => order.Status == status);

        return await query
            .OrderBy(order => order.Id)
            .Skip((int)((long)(page - 1) * size))
            .Take(size)
            .Select(order => new OrderDto(order.Id, order.Status, order.Total))
            .ToListAsync(ct);
    }
}
`;

const expectedCheckIds = [
  "di-captive-scope-rejected",
  "unauthenticated-contract",
  "validation-error-contract",
  "response-contract-array-dto",
  "filtered-paged-results",
  "relational-sql-shape",
  "relational-parameters",
  "page-bounds",
  "tenant-isolation",
  "empty-page-contract",
  "authenticated-tenant-authority",
  "cancellation-forwarded",
  "read-only-no-tracking",
  "controlled-overlap-write",
  "failure-problem-contract",
  "recovery-after-failure",
  "committed-write-between-reads",
];

test("native .NET oracle rejects baseline and mutations, accepts reference", async t => {
  let sdkProbe;
  try {
    sdkProbe = await runDotnet(["--list-sdks"], root);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("dotnet SDK is not installed");
      return;
    }
    throw error;
  }
  assert.equal(sdkProbe.code, 0, `dotnet SDK probe failed:\n${sdkProbe.output}`);
  if (!/^10\./m.test(sdkProbe.output)) {
    t.skip("a .NET 10 SDK is not installed");
    return;
  }

  const workRoot = path.join(__dirname, `.dotnet-oracle-${process.pid}-${Date.now()}`);
  const passedControls = [];
  try {
    const baseline = await makeVariant(workRoot, "baseline");
    await build(baseline);
    const baselineRun = await runDotnet(
      ["run", "--project", "Checks\\Checks.csproj"],
      baseline,
    );
    assert.equal(baselineRun.code, 1, `baseline must fail an oracle assertion:\n${baselineRun.output}`);
    assert.match(baselineRun.output.slice(-2048), /MCPEE_ORACLE_FAILURE /);
    assert.match(baselineRun.output, /"check":"response-contract-array-dto"|"check":"filtered-paged-results"/);
    passedControls.push("baseline-compiles-and-fails-assertion");

    const reference = await makeVariant(workRoot, "reference", {
      querySource: referenceQuery,
    });
    await build(reference);
    const referenceRun = await runDotnet(
      ["run", "--project", "Checks\\Checks.csproj"],
      reference,
    );
    assert.equal(referenceRun.code, 0, referenceRun.output);
    assert.deepEqual(parseResult(referenceRun.output), {
      schema_version: 1,
      id: "dotnet-api-data-change",
      status: "passed",
      checks: expectedCheckIds,
    });
    passedControls.push("reference-passes-native-normal-failure-boundary");

    await expectAssertionMutation(workRoot, "tenant-filter", referenceQuery.replace(
      ".Where(order => order.TenantId == tenant)",
      ".Where(order => order.TenantId != tenant)",
    ), "filtered-paged-results");
    passedControls.push("mutation-tenant-filter-detected");

    await expectAssertionMutation(workRoot, "status-filter", referenceQuery.replace(
      "        if (status is not null)\n            query = query.Where(order => order.Status == status);\n",
      "",
    ), "filtered-paged-results");
    passedControls.push("mutation-status-filter-detected");

    await expectAssertionMutation(workRoot, "ordering", referenceQuery.replace(
      ".OrderBy(order => order.Id)",
      ".OrderByDescending(order => order.Id)",
    ), "filtered-paged-results");
    passedControls.push("mutation-order-detected");

    await expectAssertionMutation(workRoot, "bounds", referenceQuery.replace(
      ".Take(size)",
      ".Take(1000)",
    ), "filtered-paged-results");
    passedControls.push("mutation-bounds-detected");

    await expectAssertionMutation(workRoot, "cancellation", referenceQuery.replace(
      ".ToListAsync(ct)",
      ".ToListAsync()",
    ), "cancellation-forwarded");
    passedControls.push("mutation-cancellation-detected");

    const incompatibleApi = await makeVariant(workRoot, "incompatible-api", {
      querySource: referenceQuery,
      mutateApi: source => source.replace(
        "return Results.Ok(await query.LoadAsync(tenant, status, page, size, ct));",
        "return Results.Ok(new { items = await query.LoadAsync(tenant, status, page, size, ct) });",
      ),
    });
    await build(incompatibleApi);
    const incompatibleRun = await runDotnet(
      ["run", "--project", "Checks\\Checks.csproj", "--no-build", "--no-restore"],
      incompatibleApi,
    );
    assert.equal(incompatibleRun.code, 1, incompatibleRun.output);
    assert.match(incompatibleRun.output, /MCPEE_ORACLE_FAILURE .*"check":"response-contract-array-dto"/);
    passedControls.push("mutation-incompatible-response-envelope-detected");

    const captiveDi = await makeVariant(workRoot, "captive-di", {
      querySource: referenceQuery,
      mutateApi: source => source.replace(
        "builder.Services.AddScoped<OrderQuery>();",
        "builder.Services.AddSingleton<OrderQuery>();",
      ),
    });
    await build(captiveDi);
    const captiveRun = await runDotnet(
      ["run", "--project", "Checks\\Checks.csproj", "--no-build", "--no-restore"],
      captiveDi,
    );
    assert.notEqual(captiveRun.code, 0, "singleton OrderQuery unexpectedly ran with scoped DbContext");
    assert.match(captiveRun.output, /ORACLE_RUNTIME_FAILURE: (?:InvalidOperationException|AggregateException):/);
    assert.match(captiveRun.output, /scoped/i);
    passedControls.push("mutation-captive-dbcontext-lifetime-detected");

    console.log("MCPEE_ORACLE_RESULT " + JSON.stringify({
      schema_version: 1,
      id: "dotnet-api-data-change",
      status: "passed",
      checks: passedControls,
    }));
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true });
  }
});

async function makeVariant(workRoot, name, { querySource, mutateApi } = {}) {
  const directory = path.join(workRoot, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.cp(fixture, directory, { recursive: true });
  if (querySource !== undefined) {
    await fs.writeFile(path.join(directory, "Api", "OrderQuery.cs"), querySource, "utf8");
  }
  if (mutateApi) {
    const apiPath = path.join(directory, "Api", "Program.cs");
    const original = await fs.readFile(apiPath, "utf8");
    const mutated = mutateApi(original);
    assert.notEqual(mutated, original, `${name} mutation found no source target`);
    await fs.writeFile(apiPath, mutated, "utf8");
  }
  return directory;
}

async function build(directory) {
  const result = await runDotnet(
    ["build", "Checks\\Checks.csproj", "--nologo", "--verbosity", "quiet"],
    directory,
  );
  assert.equal(result.code, 0, `native build failed in ${path.basename(directory)}:\n${result.output}`);
}

async function expectAssertionMutation(workRoot, name, querySource, checkId) {
  const directory = await makeVariant(workRoot, name, { querySource });
  await build(directory);
  const result = await runDotnet(
    ["run", "--project", "Checks\\Checks.csproj", "--no-build", "--no-restore"],
    directory,
  );
  assert.equal(result.code, 1, `${name} mutation did not fail as an assertion:\n${result.output}`);
  assert.match(result.output, new RegExp(`MCPEE_ORACLE_FAILURE .*"check":"${checkId}"`));
}

function parseResult(output) {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith("MCPEE_ORACLE_RESULT "));
  assert.equal(lines.length, 1, `expected exactly one native result marker:\n${output}`);
  return JSON.parse(lines[0].slice("MCPEE_ORACLE_RESULT ".length));
}

function runDotnet(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("dotnet", args, { cwd, windowsHide: true });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });
    const timeout = setTimeout(() => child.kill(), 240_000);
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}
