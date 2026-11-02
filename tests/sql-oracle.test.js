"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const controls = {
  "eligible.sql": `SELECT c.id FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM blocked_customers b WHERE b.customer_id = c.id)
ORDER BY c.id;`,
  "totals.sql": `SELECT c.id, COALESCE(SUM(o.amount), 0) FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
GROUP BY c.id ORDER BY c.id;`,
  "page.sql": `SELECT id, score FROM customers
WHERE :last_score IS NULL OR score < :last_score OR (score = :last_score AND id < :last_id)
ORDER BY score DESC, id DESC LIMIT :limit;`,
};

test("native SQL oracle executes SQLite baseline, repaired queries and semantic mutations", t => {
  const runtime = spawnSync("python", ["--version"], { encoding: "utf8", timeout: 10000 });
  if (runtime.error?.code === "ENOENT") return t.skip("Python unavailable; native SQLite checks not run.");
  assert.equal(runtime.status, 0, runtime.stderr);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpee-sql-oracle-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.cpSync(path.resolve(__dirname, "../templates/specialist-acceptance/sql-result-semantics"), root,
    { recursive: true });
  const run = () => spawnSync("python", ["-B", "checks.py"], {
    cwd: root, encoding: "utf8", timeout: 60000,
  });
  const baseline = run();
  assert.equal(baseline.error, undefined);
  assert.equal(baseline.status, 1, baseline.stdout + baseline.stderr);
  assert.match(baseline.stdout, /MCPEE_ORACLE_FAILURE /);
  for (const [file, contents] of Object.entries(controls)) fs.writeFileSync(path.join(root, file), contents);
  const candidate = run();
  assert.equal(candidate.status, 0, candidate.stdout + candidate.stderr);
  const marker = candidate.stdout.split(/\r?\n/).find(line => line.startsWith("MCPEE_ORACLE_RESULT "));
  assert.ok(marker, candidate.stdout);
  assert.equal(JSON.parse(marker.slice("MCPEE_ORACLE_RESULT ".length)).checks.length, 7);
  for (const [file, mutation] of [
    ["eligible.sql", "SELECT id FROM customers ORDER BY id;"],
    ["totals.sql", controls["totals.sql"].replace("SUM(o.amount)", "SUM(DISTINCT o.amount)")],
    ["page.sql", controls["page.sql"].replace("id < :last_id", "id <= :last_id")],
    ["page.sql", controls["page.sql"].replace("id DESC", "id ASC")],
  ]) {
    assert.notEqual(mutation, controls[file]);
    fs.writeFileSync(path.join(root, file), mutation);
    const result = run();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /MCPEE_ORACLE_FAILURE /);
    assert.doesNotMatch(result.stdout, /MCPEE_ORACLE_RESULT /);
    fs.writeFileSync(path.join(root, file), controls[file]);
  }
});
