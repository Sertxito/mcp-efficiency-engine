"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { behaviorFacts, testBodyAssertions } = require("../packages/spec-engine/src/behavior");
const { stackCapability } = require("../packages/spec-engine/src/stack-evidence");
const { testCases } = require("../packages/spec-engine/src/domains");

const fixtures = [
  ["service.cs", "csharp", "public bool Accept(int value) {\n  if (value < 8) return false;\n  return true;\n}", "return"],
  ["service.js", "javascript", "function accept(value) {\n  if (value < 8) throw new Error('short');\n}", "throw"],
  ["service.ts", "typescript", "function accept(value: number): boolean {\n  return value > 0;\n}", "return"],
  ["service.py", "python", "def accept(value):\n    if value < 8:\n        raise ValueError('short')\n    return value", "throw"],
  ["schema.sql", "sql", "CREATE TABLE Accounts (\n id int PRIMARY KEY,\n age int CHECK (age >= 18)\n);\nBEGIN TRANSACTION;\nINSERT INTO Accounts VALUES (1, 18);\nCOMMIT;", "constraint-declaration"],
  ["deploy.ps1", "powershell", "function Deploy {\n param([string]$Name)\n if (!$Name) {\n  throw 'missing'\n }\n Set-Content -Path result.txt -Value $Name\n}", "state-operation-call"],
  ["main.bicep", "bicep", "param enabled bool\nresource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (enabled) {\n name: 'example'\n dependsOn: []\n}", "resource-declaration"],
  [".github/workflows/check.yml", "pipeline-yaml", "jobs:\n  test:\n    steps:\n      - run: |\n          echo hello\n      - uses: actions/checkout@v4", "pipeline-command-declaration"],
  ["account.component.html", "angular-template", '<form [formGroup]="account" (ngSubmit)="save()">\n<input formControlName="name" required minlength="3">\n</form>', "template-form-declaration"],
  ["Account.tsx", "react", "function Account() {\n return <button onClick={() => save()}>Save</button>;\n}", "jsx-event-binding"],
];

for (const [filename, family, text, observation] of fixtures) {
  test(`${family} produces cited implementation evidence, not an execution claim`, () => {
    const capability = stackCapability(filename);
    assert.equal(capability.family, family);
    assert.equal(capability.level, "static-syntax-partial");
    assert.ok(capability.limitations.length > 20);
    const facts = behaviorFacts(text, filename);
    assert.ok(facts.some((item) => item.observations.includes(observation)), filename);
    for (const fact of facts) {
      assert.equal(fact.certainty, "observed-syntax");
      assert.ok(fact.line >= 1 && fact.line <= text.split("\n").length);
      assert.equal(fact.summary, text.split("\n")[fact.line - 1].trim());
    }
  });
}

for (const [filename, text] of [
  ["sample.py", '# if fake: raise ValueError()\nexample = """\nassert fake\nreturn fake\n"""\n'],
  ["sample.sql", "-- DELETE FROM Accounts;\n/* COMMIT;\nUPDATE Accounts SET id = 0;\n*/\nPRINT 'DELETE FROM Accounts;';"],
  ["sample.ps1", "# Remove-Item example\n<#\nthrow 'fake'\n#>\n$message = @'\nRemove-Item example\n'@\n"],
  ["sample.bicep", "// resource fake 'type' = {}\n/* param fake bool */\nvar example = 'dependsOn: []'"],
  ["sample.html", '<!-- <input required (click)="fake()"> -->\n<script>const example = "(click)=fake required";</script>\nordinary required text'],
  [".github/workflows/example.yml", '# run: destructive\nname: "run: fake"\n'],
]) {
  test(`${filename} ignores comment and string contents as executable declarations`, () => {
    const facts = behaviorFacts(text, filename);
    assert.ok(facts.every((item) => item.observations.every((kind) =>
      ["assignment", "configuration-declaration"].includes(kind))), JSON.stringify(facts));
  });
}

test("Python scopes and if-conditions respect dedents; assertions belong to their test only", () => {
  const text = [
    "def accept(value):",
    "    if value < 8:",
    "        raise ValueError('short')",
    "    return value",
    "",
    "def test_short():",
    "    assert accept(8) == 8",
    "",
    "def test_other():",
    "    assert accept(9) == 9",
  ].join("\n");
  const facts = behaviorFacts(text, "test_accounts.py");
  assert.deepEqual(facts.find((item) => item.line === 3).enclosing_conditions, [{ line: 2, condition: "value < 8" }]);
  assert.equal(facts.find((item) => item.line === 4).enclosing_conditions.length, 0);
  assert.equal(facts.find((item) => item.line === 3).scope, "accept");
  assert.deepEqual(testBodyAssertions(text, 6, facts, "test_accounts.py").assertions.map((item) => item.line), [7]);
  assert.deepEqual(testBodyAssertions(text, 9, facts, "test_accounts.py").assertions.map((item) => item.line), [10]);
  const scenarios = testCases([{ path: "service.py", category: "source-code", facts, test_cases: [] }]);
  assert.ok(scenarios.some((item) => item.kind === "implementation-candidate" && item.line === 3));
});

test("C# test assertions are bounded by the annotated method, not the next method", () => {
  const text = [
    "[Fact]",
    "public void Accepts() {",
    "  Assert.Equal(8, Accept(8));",
    "}",
    "[Fact]",
    "public void Rejects() {",
    "  Assert.Throws<ArgumentException>(() => Accept(-1));",
    "}",
  ].join("\n");
  const facts = behaviorFacts(text, "AccountTests.cs");
  assert.deepEqual(testBodyAssertions(text, 1, facts, "AccountTests.cs").assertions.map((item) => item.line), [3]);
  assert.deepEqual(testBodyAssertions(text, 5, facts, "AccountTests.cs").assertions.map((item) => item.line), [7]);
});

test("Pester assertions are associated with their It block and not the next test", () => {
  const text = [
    "It 'accepts input' {",
    "  Get-Result | Should -Be 8",
    "}",
    "It 'rejects input' {",
    "  { Invoke-Invalid } | Should -Throw",
    "}",
  ].join("\n");
  const facts = behaviorFacts(text, "Account.Tests.ps1");
  assert.deepEqual(testBodyAssertions(text, 1, facts, "Account.Tests.ps1").assertions.map((item) => item.line), [2]);
  assert.deepEqual(testBodyAssertions(text, 4, facts, "Account.Tests.ps1").assertions.map((item) => item.line), [5]);
});

test("C# and Pester CRLF associations do not borrow a previous or following body", () => {
  const csharp = [
    "[Fact]",
    "public void First() {",
    "  Assert.True(true);",
    "}",
    "[Fact]",
    "public void Second() {",
    "  Assert.False(false);",
    "}",
  ].join("\r\n");
  const csharpFacts = behaviorFacts(csharp, "Tests.cs");
  assert.deepEqual(testBodyAssertions(csharp, 5, csharpFacts, "Tests.cs").assertions.map((item) => item.line), [7]);
  const pester = [
    "It 'external' -Test externalFunction",
    "It 'real' {",
    "  $value | Should -Be 8",
    "}",
  ].join("\r\n");
  const pesterFacts = behaviorFacts(pester, "Tests.ps1");
  assert.equal(testBodyAssertions(pester, 1, pesterFacts, "Tests.ps1").status, "unsupported-body");
  assert.deepEqual(testBodyAssertions(pester, 2, pesterFacts, "Tests.ps1").assertions.map((item) => item.line), [3]);
});

test("unsupported families, generic YAML, tab suites and expression test methods remain explicit gaps", () => {
  for (const file of ["sample.vue", "sample.java", "sample.rb", "config.yaml", "styles.scss"]) assert.equal(stackCapability(file), null);
  const python = "def test_tab():\n\tassert value\n";
  assert.equal(testBodyAssertions(python, 1, behaviorFacts(python, "test.py"), "test.py").status, "unsupported-body");
  const csharp = "[Fact]\npublic void Expression() => Assert.True(true);\npublic void Next() { Assert.False(false); }";
  assert.equal(testBodyAssertions(csharp, 1, behaviorFacts(csharp, "Tests.cs"), "Tests.cs").status, "unsupported-body");
});

test("multiline Angular tags retain exact attribute lines, quoted > and multiple elements", () => {
  const text = [
    "<form",
    '  [formGroup]="account"',
    '  (ngSubmit)="save()">',
    '  <input required><button (click)="value > 0 && save()">Save</button>',
    "</form> plain required text",
  ].join("\n");
  const facts = behaviorFacts(text, "account.html");
  assert.ok(facts.find((item) => item.line === 2).observations.includes("template-property-binding"));
  assert.ok(facts.find((item) => item.line === 3).observations.includes("template-event-binding"));
  assert.ok(facts.find((item) => item.line === 4).observations.includes("template-event-binding"));
  assert.ok(!facts.some((item) => item.line === 5));
  assert.equal(behaviorFacts('<div title="required (click)=fake [formGroup]=fake"></div>', "account.html").length, 0);
});

test("Python enclosing conditions do not cross nested function definition boundaries", () => {
  const text = "def outer(value):\n    if value:\n        def inner():\n            return 1\n        return 2";
  const facts = behaviorFacts(text, "account.py");
  assert.equal(facts.find((item) => item.line === 4).enclosing_conditions.length, 0);
  assert.equal(facts.find((item) => item.line === 5).enclosing_conditions[0].condition, "value");
});

test("Python continuation statements do not create fake scopes or erase outer conditions", () => {
  const text = [
    "def accept(value):",
    "    if value:",
    "        result = (",
    "            value",
    "        )",
    "        return result",
    "    class Inner:",
    "        raise ValueError('not a function body')",
  ].join("\n");
  const facts = behaviorFacts(text, "account.py");
  assert.equal(facts.find((item) => item.line === 6).scope, "accept");
  assert.deepEqual(facts.find((item) => item.line === 6).enclosing_conditions.map((item) => item.condition), ["value"]);
  assert.equal(facts.find((item) => item.line === 8).scope, "unresolved");
});

test("pipeline prose block scalars are not treated as executable script evidence", () => {
  const text = "name: |\n  run: fake command\njobs:\n  build:\n    steps:\n      - run: |\n          echo real command";
  const facts = behaviorFacts(text, ".github/workflows/check.yml");
  assert.ok(!facts.some((item) => item.line === 2));
  assert.ok(facts.find((item) => item.line === 7).observations.includes("pipeline-script-line"));
});

test("pipeline script blocks stop before sibling properties in the same step", () => {
  const text = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - run: |",
    "          echo real command",
    "        name: prose title",
    "        env:",
    "          EXAMPLE: not a script",
    "      - name: another step",
    "        run: echo next command",
  ].join("\n");
  const facts = behaviorFacts(text, ".github/workflows/check.yml");
  assert.deepEqual(facts.filter((item) => item.observations.includes("pipeline-script-line")).map((item) => item.line), [5]);
  assert.ok(facts.find((item) => item.line === 10).observations.includes("pipeline-command-declaration"));
});
