"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { behaviorFacts, testBodyAssertions } = require("../packages/spec-engine/src/behavior");
const { testCases, renderCasePages, renderObservationPages } = require("../packages/spec-engine/src/domains");

test("implementation evidence cites method scope, nested conditions, outcomes and state calls", () => {
  const text = [
    "public class AuthService {",
    "  public async Task<User> Login(string email) {",
    "    if (email is null) return null;",
    "    if (email.Length < 8) {",
    "      if (email.Length == 0) {",
    '        throw new ArgumentException("missing");',
    "      }",
    "      return null;",
    "    }",
    "    await _db.SaveChangesAsync();",
    "    return user;",
    "  }",
    "}",
  ].join("\n");
  const facts = behaviorFacts(text, "AuthService.cs");
  const failure = facts.find((item) => item.observations.includes("throw"));
  assert.equal(failure.scope, "Login");
  assert.equal(failure.line, 6);
  assert.deepEqual(failure.enclosing_conditions.map((item) => item.condition), ["email.Length < 8", "email.Length == 0"]);
  assert.deepEqual(facts.find((item) => item.line === 8).enclosing_conditions.map((item) => item.condition), ["email.Length < 8"]);
  assert.equal(facts.find((item) => item.line === 11).enclosing_conditions.length, 0);
  assert.ok(facts.find((item) => item.line === 10).observations.includes("state-operation-call"));
  const cases = testCases([{ path: "AuthService.cs", category: "source-code", facts, test_cases: [] }]);
  const scenario = cases.find((item) => item.kind === "implementation-candidate" && item.line === 6);
  assert.equal(scenario.behavior, "observed-syntax");
  assert.equal(scenario.automation, "not-assessed");
  assert.equal(scenario.execution, "not-run-by-discovery");
  assert.match(scenario.title, /email.Length < 8 AND email.Length == 0/);
  assert.match(scenario.review, /reachability.*not established/);
});

test("comments, quoted code, templates and common regex literals are not implementation evidence", () => {
  const text = [
    '// if (fake) return false;',
    '/* expect(fake).toBe(true);',
    'throw new Error("fake"); */',
    'const example = "if (fake) return false; expect(fake)";',
    "const template = `return fake; ${ignored()}`;",
    'const pattern = /if\\(fake\\) { return false; }/;',
    'function real() {',
    '  return true; // if (fake) throw new Error();',
    '}',
  ].join("\n");
  const facts = behaviorFacts(text, "example.ts");
  assert.ok(!facts.some((item) => item.observations.includes("control-flow") || item.observations.includes("throw") || item.observations.includes("assertion")));
  const realReturn = facts.find((item) => item.observations.includes("return"));
  assert.equal(realReturn.line, 8);
  assert.equal(realReturn.scope, "real");
  assert.equal(realReturn.enclosing_conditions.length, 0);
  assert.deepEqual(behaviorFacts(text, "example.md"), []);
});

test("assertions belong to their inspected test block, not neighboring tests or fixtures", () => {
  const text = [
    "beforeEach(() => { expect(setup()).toBeTrue(); });",
    'it("first", () => {',
    '  const braces = "}";',
    "  service.login().subscribe(() => {",
    "    expect(service.user()).toBeTruthy();",
    "  });",
    '  expect(localStorage.getItem("token")).toBe("value");',
    "});",
    'it("second", async () => {',
    "  await expect(page).toHaveURL(/login/);",
    "});",
  ].join("\n");
  const facts = behaviorFacts(text, "auth.spec.ts");
  const first = testBodyAssertions(text, 2, facts);
  assert.equal(first.status, "block-inspected");
  assert.deepEqual(first.assertions.map((item) => item.line), [5, 7]);
  assert.match(first.assertions[1].expression, /localStorage.getItem/);
  assert.deepEqual(testBodyAssertions(text, 9, facts).assertions.map((item) => item.line), [10]);
});

test("unsupported test bodies do not borrow assertions from the next test", () => {
  const text = [
    'test.todo("pending");',
    'test("external", externalCallback);',
    'test("real", () => {',
    "  assert.equal(result, 42);",
    "});",
  ].join("\n");
  const facts = behaviorFacts(text, "behavior.test.js");
  for (const line of [1, 2]) assert.deepEqual(testBodyAssertions(text, line, facts), { status: "unsupported-body", assertions: [] });
  assert.deepEqual(testBodyAssertions(text, 3, facts).assertions.map((item) => item.line), [4]);
});

test("indented CRLF test callbacks retain their own assertions", () => {
  const text = [
    "describe('service', () => {",
    "  it('persists a session', () => {",
    "    service.login().subscribe(() => {",
    "      expect(service.isAuthenticated()).toBeTrue();",
    "    });",
    "    expect(localStorage.getItem('token')).toBe('token');",
    "  });",
    "  it('clears a session', () => {",
    "    expect(service.user()).toBeNull();",
    "  });",
    "});",
  ].join("\r\n");
  const facts = behaviorFacts(text, "auth.spec.ts");
  assert.deepEqual(testBodyAssertions(text, 2, facts).assertions.map((item) => item.line), [4, 6]);
  assert.deepEqual(testBodyAssertions(text, 8, facts).assertions.map((item) => item.line), [9]);
});

test("lexical conditions do not leak into else branches or following statements", () => {
  const text = [
    "function select(value) {",
    "  if (value) {",
    "    return first;",
    "  } else {",
    "    return second;",
    "  }",
    "  return fallback;",
    "}",
  ].join("\n");
  const facts = behaviorFacts(text, "select.ts");
  assert.equal(facts.find((item) => item.line === 3).enclosing_conditions.length, 1);
  assert.equal(facts.find((item) => item.line === 5).enclosing_conditions.length, 0);
  assert.equal(facts.find((item) => item.line === 7).enclosing_conditions.length, 0);
});

test("same-line unconditional outcomes are not attributed to a preceding condition", () => {
  for (const text of [
    "function select(value) {\n if (value) return first; return fallback;\n}",
    "function select(value) {\n if (value) { return first; } return fallback;\n}",
  ]) {
    const fact = behaviorFacts(text, "select.ts").find((item) => item.line === 2);
    assert.equal(fact.enclosing_conditions.length, 0);
  }
});

test("conditions do not cross deferred function bodies or same-line calls after a branch", () => {
  const text = [
    "function select(value) {",
    " if (value) {",
    "   function delayed() {",
    "     return fallback;",
    "   }",
    "   const callback = () => {",
    "     return fallback;",
    "   };",
    "   if (other) { store.save(); } store.remove();",
    " }",
    "}",
  ].join("\n");
  const facts = behaviorFacts(text, "select.ts");
  assert.equal(facts.find((item) => item.line === 4).enclosing_conditions.length, 0);
  assert.equal(facts.find((item) => item.line === 7).enclosing_conditions.length, 0);
  assert.deepEqual(facts.find((item) => item.line === 9).enclosing_conditions.map((item) => item.condition), ["value"]);
});

test("source syntax remains literal instead of injecting Markdown links or table columns", () => {
  const expression = 'return "[diagram](diagram.png) | `example` **value**";';
  const source = {
    path: "src/example.ts", category: "source-code", test_cases: [],
    facts: [{ kind: "implementation-observation", observations: ["return"],
      scope: "example", line: 2, summary: expression, enclosing_conditions: [{ line: 1, condition: "value" }] }],
  };
  const options = { slug: "example", sources: [source],
    specPath: ".mcpee/specs/proposed/example.md", evidencePath: ".mcpee/specs/proposed/example.evidence.json" };
  for (const page of [...renderObservationPages(options), ...renderCasePages({ ...options, cases: testCases([source]) })]) {
    assert.doesNotMatch(page.content, /\[diagram\]\(diagram.png\)/);
    assert.match(page.content, /&#91;diagram&#93;\(diagram.png\) &#124; &#96;example&#96;/);
  }
});
