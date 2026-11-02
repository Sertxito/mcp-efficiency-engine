"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { test } = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "src", "candidate.ts");
const source = process.env.MCPEE_ORACLE_SOURCE_BASE64
  ? Buffer.from(process.env.MCPEE_ORACLE_SOURCE_BASE64, "base64").toString("utf8")
  : fs.readFileSync(sourcePath, "utf8");
let vueRuntime;

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
      esModuleInterop: true,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics || []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => __dirname,
    getCanonicalFileName: filename => filename,
    getNewLine: () => "\n",
  }));
  const filename = path.join(__dirname, "src", "runtime-oracle.cjs");
  const virtualModule = new Module(filename);
  virtualModule.filename = filename;
  virtualModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  virtualModule._compile(output.outputText, filename);
  return virtualModule.exports;
}

function compilerDiagnostics() {
  const configPath = path.join(__dirname, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return [config.error];
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, __dirname, { noEmit: true }, configPath);
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

async function loadRuntime() {
  if (vueRuntime) return vueRuntime;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Node = dom.window.Node;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.SVGElement = dom.window.SVGElement;
  global.Document = dom.window.Document;
  global.Event = dom.window.Event;
  global.MouseEvent = dom.window.MouseEvent;
  const Vue = await import("vue");
  const { SearchView } = compileTarget();
  const { renderToString } = await import("@vue/server-renderer");
  vueRuntime = { dom, Vue, SearchView, renderToString };
  return vueRuntime;
}

function deferredSearch() {
  const requests = [];
  const search = (query, signal) => new Promise(resolve => requests.push({ query, signal, resolve }));
  return { requests, search };
}

async function mount(t, SearchView, props) {
  const runtime = await loadRuntime();
  const state = runtime.Vue.reactive({ query: props.query });
  const wrapper = runtime.Vue.defineComponent({
    setup: () => () => runtime.Vue.h(SearchView, { ...props, query: state.query }),
  });
  const host = runtime.dom.window.document.createElement("div");
  runtime.dom.window.document.body.append(host);
  const app = runtime.Vue.createApp(wrapper);
  app.mount(host);
  t.after(() => {
    app.unmount();
    host.remove();
  });
  return { ...runtime, state, host, app };
}

test("ts-typecheck", () => {
  const diagnostics = compilerDiagnostics();
  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => __dirname,
      getCanonicalFileName: filename => filename,
      getNewLine: () => "\n",
    }));
  }
  process.stdout.write("[MCPEE_TYPECHECK:passed]\n");
});

test("input-immutability", async t => {
  const { SearchView } = await loadRuntime();
  const rows = [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }];
  await mount(t, SearchView, { query: "sort", rows, search: async () => [] });
  check("input-immutability", rows.map(row => row.id), ["b", "a"]);
});

test("reactive-render", async t => {
  const { SearchView } = await loadRuntime();
  const mounted = await mount(t, SearchView, { query: "count", rows: [], search: async () => [] });
  check("reactive-render", mounted.host.querySelector("#count").textContent, "0", "equal");
  mounted.host.querySelector("#increment").dispatchEvent(new mounted.dom.window.MouseEvent("click", { bubbles: true }));
  await mounted.Vue.nextTick();
  check("reactive-render", mounted.host.querySelector("#count").textContent, "1", "equal");
});

test("latest-request-wins", async t => {
  const { SearchView } = await loadRuntime();
  const deferred = deferredSearch();
  const mounted = await mount(t, SearchView, { query: "old", rows: [], search: deferred.search });
  mounted.state.query = "new";
  await mounted.Vue.nextTick();
  check("latest-request-wins", deferred.requests.map(request => request.query), ["old", "new"]);
  deferred.requests[1].resolve([{ id: "new", name: "New result" }]);
  await Promise.resolve();
  await mounted.Vue.nextTick();
  deferred.requests[0].resolve([{ id: "old", name: "Old result" }]);
  await Promise.resolve();
  await mounted.Vue.nextTick();
  check("latest-request-wins", mounted.host.querySelector("#results").textContent, "New result");
});

test("unmount-aborts-request", async t => {
  const { SearchView } = await loadRuntime();
  const deferred = deferredSearch();
  const mounted = await mount(t, SearchView, { query: "pending", rows: [], search: deferred.search });
  check("unmount-aborts-request", deferred.requests.length, 1, "equal");
  mounted.app.unmount();
  check("unmount-aborts-request", deferred.requests[0].signal.aborted, true, "equal");
});

test("server-render", async () => {
  const { Vue, SearchView, renderToString } = await loadRuntime();
  const html = await renderToString(Vue.createSSRApp(SearchView, {
    query: "server-query",
    rows: [],
    search: async () => [],
  }));
  check("server-render", html.includes("server-query"), true, "equal");
});
