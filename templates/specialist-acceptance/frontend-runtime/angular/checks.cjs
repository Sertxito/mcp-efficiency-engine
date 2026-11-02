"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { test } = require("node:test");
const ts = require("typescript");

const fixture = __dirname;
const sourcePath = path.join(fixture, "src", "candidate.ts");
const source = process.env.MCPEE_ORACLE_SOURCE_BASE64
  ? Buffer.from(process.env.MCPEE_ORACLE_SOURCE_BASE64, "base64").toString("utf8")
  : fs.readFileSync(sourcePath, "utf8");
let framework;

function check(id, actual, expected, method = "deepEqual") {
  try {
    assert[method](actual, expected);
  } catch (error) {
    error.message = `[MCPEE_BEHAVIOR:${id}] ${error.message}`;
    throw error;
  }
}

function compileTarget() {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      experimentalDecorators: true,
      esModuleInterop: true,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics || []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => fixture,
    getCanonicalFileName: filename => filename,
    getNewLine: () => "\n",
  }));
  const filename = path.join(fixture, "src", "runtime-oracle.cjs");
  const virtualModule = new Module(filename);
  virtualModule.filename = filename;
  virtualModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  virtualModule._compile(output.outputText, filename);
  return virtualModule.exports;
}

function compilerDiagnostics() {
  const configPath = path.join(fixture, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return [config.error];
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fixture, { noEmit: true }, configPath);
  if (parsed.errors.length > 0) return parsed.errors;
  const host = ts.createCompilerHost(parsed.options);
  const originalReadFile = host.readFile.bind(host);
  host.readFile = filename => path.resolve(filename) === sourcePath ? source : originalReadFile(filename);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(filename) === sourcePath
      ? ts.createSourceFile(filename, source, languageVersion, true, ts.ScriptKind.TS)
      : originalGetSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
  return ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options, host));
}

async function loadFramework() {
  if (framework) return framework;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Node = dom.window.Node;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
  await import("zone.js");
  await import("@angular/compiler");
  const { getTestBed } = await import("@angular/core/testing");
  const { BrowserDynamicTestingModule, platformBrowserDynamicTesting } =
    await import("@angular/platform-browser-dynamic/testing");
  const testBed = getTestBed();
  if (!testBed.platform) testBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  const component = compileTarget();
  framework = { dom, testBed, ...component };
  return framework;
}

async function createFixture(query, rows, search) {
  const { testBed, SearchComponent, SEARCH_API } = await loadFramework();
  testBed.resetTestingModule();
  testBed.configureTestingModule({
    imports: [SearchComponent],
    providers: [{ provide: SEARCH_API, useValue: { search } }],
  });
  const fixture = testBed.createComponent(SearchComponent);
  fixture.componentRef.setInput("query", query);
  fixture.componentRef.setInput("rows", rows);
  fixture.detectChanges();
  await new Promise(resolve => setTimeout(resolve, 0));
  return fixture;
}

function deferredSearch() {
  const requests = [];
  const search = (query, signal) => new Promise(resolve => requests.push({ query, signal, resolve }));
  return { requests, search };
}

test("ts-typecheck", () => {
  const diagnostics = compilerDiagnostics();
  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => fixture,
      getCanonicalFileName: filename => filename,
      getNewLine: () => "\n",
    }));
  }
  process.stdout.write("[MCPEE_TYPECHECK:passed]\n");
});

test("input-immutability", async () => {
  const rows = [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }];
  const fixture = await createFixture("sort", rows, async () => []);
  check("input-immutability", rows.map(row => row.id), ["b", "a"]);
  fixture.destroy();
});

test("latest-request-wins", async () => {
  const deferred = deferredSearch();
  const fixture = await createFixture("old", [], deferred.search);
  fixture.componentRef.setInput("query", "new");
  fixture.detectChanges();
  await new Promise(resolve => setTimeout(resolve, 0));
  check("latest-request-wins", deferred.requests.map(request => request.query), ["old", "new"]);
  deferred.requests[1].resolve([{ id: "new", name: "New result" }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  deferred.requests[0].resolve([{ id: "old", name: "Old result" }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();
  check("latest-request-wins", fixture.nativeElement.querySelector("#results").textContent, "New result");
  fixture.destroy();
});

test("destroy-aborts-request", async () => {
  const deferred = deferredSearch();
  const fixture = await createFixture("pending", [], deferred.search);
  check("destroy-aborts-request", deferred.requests.length, 1, "equal");
  fixture.destroy();
  check("destroy-aborts-request", deferred.requests[0].signal.aborted, true, "equal");
});

test("server-render", async () => {
  const { SearchComponent, SEARCH_API } = await loadFramework();
  const { Component } = await import("@angular/core");
  const { bootstrapApplication } = await import("@angular/platform-browser");
  const { renderApplication } = await import("@angular/platform-server");
  class OracleShell {
    query = "server-query";
    rows = [];
  }
  Component({
    selector: "app-root",
    standalone: true,
    imports: [SearchComponent],
    template: '<mcpee-search [query]="query" [rows]="rows" />',
  })(OracleShell);
  const html = await renderApplication(
    context => bootstrapApplication(OracleShell, {
      providers: [{ provide: SEARCH_API, useValue: { search: async () => [] } }],
    }, context),
    { document: "<app-root></app-root>", url: "http://localhost/" },
  );
  check("server-render", html.includes("server-query"), true, "equal");
  framework.dom.window.close();
});
