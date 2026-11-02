"use strict";

const checks = {
  "dotnet-entry": {
    "captive-context": ({ source }) =>
      /AddSingleton<ReportService>\(\)/.test(source) &&
      /ReportService\(AppDbContext db\)/.test(source),
    "parallel-context": ({ source }) =>
      /Task\.WhenAll\(db\.Orders\.ToListAsync\(\),\s*db\.Customers\.ToListAsync\(\)\)/.test(source),
  },
  "python-entry": {
    "mutable-default": ({ source }) =>
      /async def handle\(value,\s*history=\[\]\)/.test(source) &&
      /history\.append\(value\)/.test(source),
    "blocked-loop": ({ source }) =>
      /async def handle/.test(source) && /time\.sleep\(1\)/.test(source) &&
      !/await\s+asyncio\.sleep/.test(source),
  },
  "node-entry": {
    "blocking-io": ({ source }) =>
      /async function handle\(file,\s*jobs\)[\s\S]*fs\.readFileSync\(file/.test(source),
    "unbounded-fanout": ({ source }) =>
      /async function handle\(file,\s*jobs\)[\s\S]*Promise\.all\(jobs\.map\(job => remoteWrite\(job\)\)\)/.test(source),
  },
  "typescript-entry": {
    "unvalidated-cast": ({ source }) => /JSON\.parse\(raw\)\s+as\s+Input/.test(source),
    "zero-fallback": ({ source }) => /input\.count\s*\|\|\s*10/.test(source),
  },
  "angular-entry": {
    "subscription-cleanup": ({ source }) =>
      /effect\(\(\)\s*=>\s*\{[\s\S]*\.subscribe\(/.test(source) &&
      !/onCleanup|unsubscribe\(/.test(source),
    "stale-search": ({ source }) =>
      /this\.api\.search\(this\.query\(\)\)\.subscribe\(rows => this\.rows\.set\(rows\)\)/.test(source),
  },
  "react-entry": {
    "prop-mutation": ({ source }) => /\brows\.sort\(/.test(source),
    "stale-effect": ({ source }) =>
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*fetch\([\s\S]*\},\s*\[\]\)/.test(source),
  },
  "vue-entry": {
    "lost-reactivity": ({ source }) =>
      /const count = state\.count/.test(source) && /\{\{ count \}\}/.test(source),
    "impure-computed": ({ source }) => /computed\(\(\)\s*=>\s*state\.rows\.sort\(\)\)/.test(source),
  },
  "sql-entry": {
    "nullable-antijoin": ({ source, context }) =>
      /NOT IN\s*\(SELECT\s+CustomerId\s+FROM\s+DisabledCustomers\)/i.test(source) &&
      /CustomerId is nullable/i.test(context),
    "nondeterministic-page": ({ source }) =>
      /\bTOP\s*\(\s*20\s*\)/i.test(source) && !/\bORDER\s+BY\b/i.test(source),
  },
  "cosmos-entry": {
    "cross-partition-batch": ({ source, context }) =>
      /CreateTransactionalBatch\(new PartitionKey\("tenant-a"\)\)/.test(source) &&
      /CreateItem\(a\)\.CreateItem\(b\)/.test(source) &&
      /a belongs to tenant-a, b belongs to tenant-b/i.test(context),
    "unbounded-retry": ({ source, context }) =>
      /catch\s*\(CosmosException\)[\s\S]*SaveAgainForever\(a,\s*b\)/.test(source) &&
      /indefinitely/i.test(context),
  },
  "bicep-entry": {
    "unstable-resource-name": ({ source }) =>
      /deploymentStamp string = utcNow\(\)/.test(source) &&
      /name:\s*'store\$\{uniqueString\(resourceGroup\(\)\.id,\s*deploymentStamp\)\}'/.test(source),
    "secret-output": ({ source }) =>
      /@secure\(\)\s*param password string/.test(source) &&
      /output exposedPassword string = password/.test(source),
  },
  "terraform-entry": {
    "index-identity-drift": ({ source }) =>
      /count\s*=\s*length\(var\.customers\)/.test(source) &&
      /var\.customers\[count\.index\]/.test(source) &&
      /lifecycle\s*\{\s*ignore_changes\s*=\s*all\s*\}/.test(source),
    "sensitive-output": ({ source }) =>
      /output "database_password"\s*\{[\s\S]*value\s*=\s*var\.database_password[\s\S]*\}/.test(source) &&
      !/output "database_password"\s*\{[\s\S]*sensitive\s*=\s*true/.test(source),
  },
  "pipeline-entry": {
    "privileged-untrusted-code": ({ source }) =>
      /on:\s*pull_request_target/.test(source) &&
      /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/.test(source) &&
      /-\s*run:\s*npm install && npm test/.test(source),
    "excess-token-permission": ({ source }) => /permissions:\s*write-all/.test(source),
  },
  "azure-entry": {
    "duplicate-charge": ({ source, context }) =>
      /"retryAttempts":\s*"unlimited"/.test(source) &&
      /"queueHandler":\s*"charge customer then acknowledge"/.test(source) &&
      /"idempotencyKey":\s*null/.test(source) &&
      /at least once/i.test(context) && /not idempotent/i.test(context),
    "unproven-recovery": ({ source }) =>
      /"backupConfigured":\s*true/.test(source) &&
      /"lastRestoreTest":\s*null/.test(source) &&
      /"claimedRecovery":\s*"RTO 5 minutes, verified"/.test(source),
  },
  "aws-entry": {
    "broad-assume-role": ({ source }) =>
      /"Principal":\s*\{\s*"AWS":\s*"\*"/.test(source) &&
      /"attachedPermissions":\s*"AdministratorAccess"/.test(source),
    "false-recovery-guarantee": ({ source }) =>
      /"multiAZ":\s*true/.test(source) && /"restoreTest":\s*null/.test(source) &&
      /all data loss and regional outages covered/.test(source),
  },
};

function inspectAuditOracle(scenario) {
  const rules = checks[scenario.id];
  if (!rules) throw new Error(`Missing technology oracle for '${scenario.id}'.`);
  const expected = new Set(scenario.variants.positive.expected.map(issue => issue.id));
  const detected = new Set(Object.entries(rules)
    .filter(([, check]) => check(scenario.variants.positive))
    .map(([id]) => id));
  if (expected.size !== detected.size || [...expected].some(id => !detected.has(id))) {
    throw new Error(`Technology oracle does not detect exactly the seeded findings for '${scenario.id}'.`);
  }
  for (const variant of ["negative", "insufficient"]) {
    const findings = Object.entries(rules)
      .filter(([, check]) => check(scenario.variants[variant]))
      .map(([id]) => id);
    if (findings.length) {
      throw new Error(`Technology oracle reports ${variant} counterexample(s) for '${scenario.id}': ${findings.join(", ")}.`);
    }
  }
  return { findings: detected.size, negative_clean: true, insufficient_abstention: true };
}

function inspectAuditOracles(scenarios) {
  if (scenarios.length !== Object.keys(checks).length) {
    throw new Error("Every technical audit scenario must have exactly one technology oracle.");
  }
  return Object.fromEntries(scenarios.map(scenario => [
    scenario.id, inspectAuditOracle(scenario),
  ]));
}

module.exports = { inspectAuditOracle, inspectAuditOracles };
