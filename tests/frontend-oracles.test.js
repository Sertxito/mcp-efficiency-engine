"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const repository = path.resolve(__dirname, "..");
const fixtureFiles = ["package.json", "package-lock.json", "tsconfig.json", "checks.cjs", "run-oracle.cjs"];

const angularControl = `import { CommonModule } from "@angular/common";
import { Component, computed, effect, inject, Input, signal, InjectionToken } from "@angular/core";

export type Row = { id: string; name: string };
export type Search = (query: string, signal: AbortSignal) => Promise<Row[]>;
export const SEARCH_API = new InjectionToken<{ search: Search }>("SEARCH_API");

@Component({
  selector: "mcpee-search",
  standalone: true,
  imports: [CommonModule],
  template: \`
    <section>
      <p id="query">{{ queryState() ?? '' }}</p>
      <button id="count" (click)="increment()">{{ count() }}</button>
      <ul id="results"><li *ngFor="let row of results()">{{ row.name }}</li></ul>
      <ol id="sorted"><li *ngFor="let row of sortedRows()">{{ row.name }}</li></ol>
    </section>
  \`,
})
export class SearchComponent {
  readonly queryState = signal<string | null>(null);
  readonly rowsState = signal<Row[]>([]);
  readonly count = signal(0);
  readonly results = signal<Row[]>([]);
  readonly sortedRows = computed(() => [...this.rowsState()].sort((left, right) => left.name.localeCompare(right.name)));
  private readonly api = inject(SEARCH_API);

  @Input()
  set query(value: string) {
    this.queryState.set(value);
  }

  @Input()
  set rows(value: Row[]) {
    this.rowsState.set(value);
  }

  constructor() {
    effect(onCleanup => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      const query = this.queryState();
      if (query !== null) {
        this.api.search(query, controller.signal).then(rows => {
          if (!controller.signal.aborted) this.results.set(rows);
        });
      }
    });
  }

  increment(): void {
    this.count.update(value => value + 1);
  }
}
`;

const reactControl = `import { useEffect, useState } from "react";

export type Row = { id: string; name: string };
export type Search = (query: string, signal: AbortSignal) => Promise<Row[]>;
export type Props = { query: string; rows: Row[]; search: Search };

export function SearchView(props: Props) {
  const [results, setResults] = useState<Row[]>([]);
  const sorted = props.rows.slice().sort((left, right) => left.name.localeCompare(right.name));

  useEffect(() => {
    const controller = new AbortController();
    props.search(props.query, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResults(rows);
    });
    return () => controller.abort();
  }, [props.query, props.search]);

  return (
    <section>
      <p id="query">{props.query}</p>
      <ul id="results">{results.map(row => <li key={row.id}>{row.name}</li>)}</ul>
      <ol id="sorted">{sorted.map(row => <li key={row.id}>{row.name}</li>)}</ol>
    </section>
  );
}
`;

const vueControl = `import { computed, defineComponent, h, reactive, watch, type PropType } from "vue";

export type Row = { id: string; name: string };
export type Search = (query: string, signal: AbortSignal) => Promise<Row[]>;

export const SearchView = defineComponent({
  props: {
    query: { type: String, required: true },
    rows: { type: Array as PropType<Row[]>, required: true },
    search: { type: Function as PropType<Search>, required: true },
  },
  setup(props) {
    const state = reactive({ count: 0, results: [] as Row[] });
    const count = computed(() => state.count);
    const sorted = computed(() => [...props.rows].sort((left, right) => left.name.localeCompare(right.name)));

    watch(
      () => props.query,
      (query, _previous, onCleanup) => {
        const controller = new AbortController();
        onCleanup(() => controller.abort());
        props.search(query, controller.signal).then(rows => {
          if (!controller.signal.aborted) state.results = rows;
        });
      },
      { immediate: true },
    );

    return () => h("section", [
      h("p", { id: "query" }, props.query),
      h("button", { id: "increment", onClick: () => { state.count += 1; } }, "Increment"),
      h("p", { id: "count" }, String(count.value)),
      h("ul", { id: "results" }, state.results.map(row => h("li", { key: row.id }, row.name))),
      h("ol", { id: "sorted" }, sorted.value.map(row => h("li", { key: row.id }, row.name))),
    ]);
  },
});
`;

const fixtures = [
  {
    id: "angular-runtime",
    relative: "templates/specialist-acceptance/frontend-runtime/angular",
    control: angularControl,
    checks: [
      "ts-typecheck",
      "input-immutability",
      "latest-request-wins",
      "destroy-aborts-request",
      "server-render",
    ],
    baselineFailures: ["input-immutability", "latest-request-wins", "destroy-aborts-request"],
    mutant: {
      source: angularControl.replace("[...this.rowsState()].sort", "this.rowsState().sort"),
      check: "input-immutability",
    },
    versions: {
      "@angular/core": "19.2.15",
      typescript: "5.7.3",
    },
  },
  {
    id: "react-runtime",
    relative: "templates/specialist-acceptance/frontend-runtime/react",
    control: reactControl,
    checks: [
      "ts-typecheck",
      "input-immutability",
      "latest-request-wins",
      "unmount-aborts-request",
      "server-render",
    ],
    baselineFailures: ["input-immutability", "latest-request-wins", "unmount-aborts-request"],
    mutant: {
      source: reactControl.replace("props.rows.slice().sort", "props.rows.sort"),
      check: "input-immutability",
    },
    versions: {
      react: "19.1.1",
      typescript: "5.7.3",
    },
  },
  {
    id: "vue-runtime",
    relative: "templates/specialist-acceptance/frontend-runtime/vue",
    control: vueControl,
    checks: [
      "ts-typecheck",
      "input-immutability",
      "reactive-render",
      "latest-request-wins",
      "unmount-aborts-request",
      "server-render",
    ],
    baselineFailures: [
      "input-immutability",
      "reactive-render",
      "latest-request-wins",
      "unmount-aborts-request",
    ],
    mutant: {
      source: vueControl.replace("const count = computed(() => state.count);", "const count = computed(() => 0);"),
      check: "reactive-render",
    },
    versions: {
      vue: "3.5.13",
      typescript: "5.7.3",
    },
  },
];

function fixturePath(config, oracleRoot) {
  return path.join(oracleRoot, config.relative);
}

function restoreDependencies(fixture, oracleRoot) {
  const env = { ...process.env, MCPEE_FRONTEND_ORACLE_ROOT: oracleRoot };
  delete env.NODE_TEST_CONTEXT;
  delete env.MCPEE_ORACLE_SOURCE_BASE64;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "npm_config_allow_scripts") delete env[key];
  }
  const args = ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--include=dev",
    "--cache", path.join(oracleRoot, ".npm-cache"), "--logs-dir", path.join(oracleRoot, ".npm-logs")];
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const result = fs.existsSync(npmCli)
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd: fixture, env, encoding: "utf8", timeout: 180000 })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      cwd: fixture, env, encoding: "utf8", timeout: 180000, shell: process.platform === "win32",
    });
  const diagnostic = `Dependency restore failed in ${fixture}\n${result.error?.message || ""}\n${result.stdout || ""}${result.stderr || ""}`;
  assert.equal(result.error, undefined, diagnostic);
  assert.equal(result.status, 0, diagnostic);
}

function snapshotFixture(fixture) {
  const files = new Map();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === "node_modules") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        files.set(path.relative(fixture, absolute), fs.readFileSync(absolute));
      }
    }
  }
  visit(fixture);
  return files;
}

function assertUnchanged(before, fixture, context) {
  const after = snapshotFixture(fixture);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${context}: fixture file inventory changed`);
  for (const [file, contents] of before) {
    assert.deepEqual(after.get(file), contents, `${context}: fixture file changed: ${file}`);
  }
}

function run(config, oracleRoot, source) {
  const fixture = fixturePath(config, oracleRoot);
  const env = { ...process.env, MCPEE_FRONTEND_ORACLE_ROOT: oracleRoot };
  delete env.NODE_TEST_CONTEXT;
  delete env.MCPEE_ORACLE_SOURCE_BASE64;
  if (source !== undefined) {
    env.MCPEE_ORACLE_SOURCE_BASE64 = Buffer.from(source, "utf8").toString("base64");
  }
  return spawnSync(process.execPath, ["run-oracle.cjs"], {
    cwd: fixture,
    env,
    encoding: "utf8",
    timeout: 120000,
  });
}

function marker(output, prefix) {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith(prefix));
  assert.equal(lines.length, 1, `${prefix} count; output:\n${output}`);
  return JSON.parse(lines[0].slice(prefix.length).trim());
}

function verifyBehaviorFailure(result, config, expected) {
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, 1, output);
  assert.match(output, new RegExp(`# tests ${config.checks.length}\\b`), "all compiler and native checks must execute");
  assert.match(output, new RegExp(`# fail ${expected.length}\\b`), "native tests must fail behavioral assertions");
  assert.match(output, /\[MCPEE_TYPECHECK:passed\]/, "compiler must succeed before recording behavioral failures");
  assert.deepEqual(marker(output, "MCPEE_ORACLE_FAILURE "), {
    schema_version: 1,
    id: config.id,
    status: "failed",
    checks: expected,
  });
  assert.doesNotMatch(output, /MCPEE_ORACLE_RESULT /);
}

function verifyPass(result, config) {
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, 0, output);
  assert.match(output, new RegExp(`# tests ${config.checks.length}\\b`), "all compiler and native checks must execute");
  assert.match(output, /# fail 0\b/, "all native runtime tests must pass");
  assert.match(output, /\[MCPEE_TYPECHECK:passed\]/, "pinned TypeScript compiler must pass");
  assert.deepEqual(marker(output, "MCPEE_ORACLE_RESULT "), {
    schema_version: 1,
    id: config.id,
    status: "passed",
    checks: config.checks,
  });
  assert.doesNotMatch(output, /MCPEE_ORACLE_FAILURE /);
}

test("native Angular, React and Vue runtime oracles reject defects and verify repairs", async t => {
  const selected = process.env.MCPEE_FRONTEND_ORACLE_ID
    ? fixtures.filter(config => config.id === process.env.MCPEE_FRONTEND_ORACLE_ID)
    : fixtures;
  assert.ok(selected.length > 0, "MCPEE_FRONTEND_ORACLE_ID must match a known frontend oracle");
  const oracleRoot = fs.mkdtempSync(path.join(repository, ".mcpee-frontend-oracles-"));
  const originals = selected.map(config => ({
    fixture: fixturePath(config, repository),
    snapshot: snapshotFixture(fixturePath(config, repository)),
  }));
  try {
    for (const config of selected) {
      const sourceFixture = fixturePath(config, repository);
      const copiedFixture = fixturePath(config, oracleRoot);
      const candidate = config.id === "react-runtime" ? "candidate.tsx" : "candidate.ts";
      fs.mkdirSync(path.join(copiedFixture, "src"), { recursive: true });
      for (const file of [...fixtureFiles, path.join("src", candidate)]) {
        fs.copyFileSync(path.join(sourceFixture, file), path.join(copiedFixture, file));
      }
    }
    for (const config of selected) {
    await t.test(config.id, async frameworkTest => {
      const fixture = fixturePath(config, oracleRoot);
      restoreDependencies(fixture, oracleRoot);
      const manifest = JSON.parse(fs.readFileSync(path.join(fixture, "package.json"), "utf8"));
      for (const [name, version] of Object.entries(config.versions)) {
        const pinned = manifest.dependencies?.[name] || manifest.devDependencies?.[name];
        assert.equal(pinned, version, `${name} version pin`);
      }
      assert.ok(fs.existsSync(path.join(fixture, "package-lock.json")), "isolated lockfile must be committed");
      const baselineSnapshot = snapshotFixture(fixture);
      const baseline = run(config, oracleRoot);
      assertUnchanged(baselineSnapshot, fixture, `${config.id} baseline`);
      verifyBehaviorFailure(baseline, config, config.baselineFailures);

      const controlSnapshot = snapshotFixture(fixture);
      const controlResult = run(config, oracleRoot, config.control);
      assertUnchanged(controlSnapshot, fixture, `${config.id} repaired control`);
      verifyPass(controlResult, config);

      assert.notEqual(config.mutant.source, config.control, "mutation must change the repaired implementation");
      const mutantSnapshot = snapshotFixture(fixture);
      const mutantResult = run(config, oracleRoot, config.mutant.source);
      assertUnchanged(mutantSnapshot, fixture, `${config.id} mutation`);
      verifyBehaviorFailure(mutantResult, config, [config.mutant.check]);

      const finalSnapshot = snapshotFixture(fixture);
      const finalControl = run(config, oracleRoot, config.control);
      assertUnchanged(finalSnapshot, fixture, `${config.id} repeated control`);
      verifyPass(finalControl, config);
      frameworkTest.diagnostic(
        `npm ci restored isolated copy; node run-oracle.cjs baseline: ${config.baselineFailures.length} behavioral failures; ` +
        `repaired: ${config.checks.length}/${config.checks.length} compiler/runtime checks; ` +
        `mutation rejected: ${config.mutant.check}; packaged fixture unchanged`,
      );
    });
    }
  } finally {
    fs.rmSync(oracleRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    for (const original of originals) {
      assertUnchanged(original.snapshot, original.fixture, "packaged source");
    }
  }
}, { timeout: 900000 });
