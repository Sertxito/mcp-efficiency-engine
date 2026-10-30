"use strict";

const fs = require("node:fs");
const path = require("node:path");

const READ_ONLY_TOOL_CALLS = new Set([
  "skill",
  "tool_search_tool",
  "view",
  "glob",
  "grep",
  "rg",
  "read_file",
  "read_file_contents",
  "list_dir",
  "list_directory",
  "file_search",
  "grep_search",
  "text_search",
  "codegraph_explore",
  "codegraph_search",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_node",
  "codegraph_files",
  "codegraph_status",
]);

const WRITE_TOOL_CALLS = /(?:write|edit|patch|delete|remove|move|rename|create|apply|deploy|publish|send|commit|push|merge|migrate|install|execute|run)/i;
const SECRET_ARGUMENT = /^--?(?:password|secret|token|api[-_]?key|authorization|cookie|credential)(?:=|$)/i;
const SECRET_ASSIGNMENT = /\b((?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTHORIZATION|COOKIE|CREDENTIAL)[A-Z0-9_]*|password|secret|token|api[-_]?key|authorization|cookie|credential)\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const TASK_SCOPED_FILE_TOOL = /^(?:edit|edit_file|write_file|patch_file|create_file|apply_patch)$/i;
const FILE_PATH_ARGUMENT = /^(?:file_?name|file_?path|path|paths|uri|target_?path|destination_?path|relative_?path)$/i;
const SENSITIVE_SOURCE = /(?:^|\/)(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker|\.npmrc|\.pypirc|\.netrc|secrets?|credentials?|certificates?|private|id_(?:rsa|dsa|ecdsa|ed25519)|private[-_.]?keys?)(?:\/|$)|\.(?:pem|key|p12|pfx|keystore)$/i;
const EXCLUDED_SOURCE = /(?:^|\/)(?:\.git|\.mcpee|node_modules)(?:\/|$)/i;
const HIGH_IMPACT_TASK = /\b(?:rewrite|rebuild|re-architect|rearchitect|major refactor|large[- ]scale refactor|migration|migrate|replace (?:the )?(?:stack|framework|platform|database)|redesign (?:the )?architecture)\b|(?:reescribir|reconstruir|reestructurar|rediseñar (?:la )?arquitectura|rediseña (?:la )?arquitectura|replantear (?:la )?arquitectura|cambiar (?:toda la )?arquitectura|migrar|sustituir (?:el )?(?:stack|framework|plataforma|base de datos))/i;
const TASK_WRITE_INTENT = /\b(?:add|build|create|develop|draft|edit|fix|generate|implement|make|modify|refactor|scaffold|update|write)\b|(?:añade|añadir|agrega|agregar|construye|construir|crea|crear|desarrolla|desarrollar|diseña|diseñar|documenta|documentar|edita|editar|genera|generar|haz|hacer|implementa|implementar|modifica|modificar|monta|montar|montemos|montarlo|prepara|preparar|redacta|redactar|actualiza|actualizar|corrige|corregir|escribe|escribir)/i;
const READ_ONLY_TASK = /\b(?:do not|don't|without|avoid|no)\s+(?:make|change|modify|edit|write|create|add)\b|(?:no\s+(?:modifiques|cambies|edites|escribas|crees|añadas))/i;
const DEPENDENCY_FILE = /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|pyproject\.toml|requirements(?:[-_.].*)?\.txt|pipfile(?:\.lock)?|poetry\.lock|uv\.lock|go\.(?:mod|sum)|cargo\.(?:toml|lock)|composer\.(?:json|lock)|gemfile(?:\.lock)?|mix\.(?:exs|lock)|pubspec(?:\.lock)?\.yaml|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|directory\.packages\.props|.*\.csproj)$/i;
const OPERATIONAL_PATH = /(?:^|\/)(?:\.github\/workflows|\.azure|\.vscode|infra(?:structure)?|terraform|k8s|kubernetes|helm|deploy(?:ment)?)(?:\/|$)|(?:^|\/)(?:\.gitignore|\.npmrc|\.mcp\.json|mcp\.json|dockerfile|docker-compose[^/]*|.*\.(?:tf|bicep|bicepparam))$/i;
const GENERATED_ARTIFACT_PATH = /^(?:autodocs|docs\/generated)(?:\/|$)/i;

function projectRelativePath(projectRoot, value) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) return null;
  const root = path.resolve(projectRoot);
  const candidate = value.trim();
  const absolute = path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function taskScopedWriteTargets(projectRoot, input) {
  let args = input?.toolArgs ?? input?.tool_args ?? input?.tool_input ?? input?.arguments;
  const paths = new Set();
  let invalidTarget = false;
  let destructivePatch = false;
  let foundTarget = false;
  const addPath = (value) => {
    foundTarget = true;
    const normalized = projectRelativePath(projectRoot, value);
    if (!normalized) {
      invalidTarget = true;
      return;
    }
    paths.add(normalized);
  };
  const addPatch = (text) => {
    if (typeof text !== "string") {
      invalidTarget = true;
      return;
    }
    const matches = [...text.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)];
    if (!matches.length) invalidTarget = true;
    for (const match of matches) {
      if (match[1] === "Delete") destructivePatch = true;
      addPath(match[2]);
    }
    if (/^\*\*\* Move to: /m.test(text)) destructivePatch = true;
  };
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (FILE_PATH_ARGUMENT.test(key)) {
        for (const item of Array.isArray(entry) ? entry : [entry]) addPath(item);
      } else if (/^(?:patch|diff)$/i.test(key)) {
        addPatch(entry);
      } else if (entry && typeof entry === "object") {
        visit(entry);
      }
    }
  };
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      addPatch(args);
    }
  }
  if (typeof args !== "string") visit(args);
  return { paths: [...paths].sort(), invalidTarget: invalidTarget || !foundTarget, destructivePatch };
}

function projectPathHasSymlink(projectRoot, relativePath) {
  let current = path.resolve(projectRoot);
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") break;
      throw error;
    }
  }
  return false;
}

function isTaskScopedLocalWrite(input, options = {}) {
  const toolName = String(input?.toolName || input?.tool_name || "").toLowerCase();
  const projectRoot = options.projectRoot || process.env.MCPEE_PROJECT_ROOT || process.cwd();
  if (!TASK_SCOPED_FILE_TOOL.test(toolName) || HIGH_IMPACT_TASK.test(options.task || "")) return false;
  if (typeof options.task === "string" &&
      (!TASK_WRITE_INTENT.test(options.task) || READ_ONLY_TASK.test(options.task))) return false;
  const { paths, invalidTarget, destructivePatch } = taskScopedWriteTargets(projectRoot, input);
  if (!paths.length || invalidTarget || destructivePatch) return false;
  if (options.newFilesOnly === true && paths.some((sourcePath) =>
    fs.existsSync(path.join(projectRoot, sourcePath)) && !GENERATED_ARTIFACT_PATH.test(sourcePath))) return false;
  if (/^(?:write_file|create_file)$/i.test(toolName) &&
      paths.some((sourcePath) => fs.existsSync(path.join(projectRoot, sourcePath)) &&
        !GENERATED_ARTIFACT_PATH.test(sourcePath))) return false;
  return paths.every((sourcePath) => {
    const basename = path.posix.basename(sourcePath);
    return !SENSITIVE_SOURCE.test(sourcePath) &&
      !EXCLUDED_SOURCE.test(sourcePath) &&
      !DEPENDENCY_FILE.test(basename) &&
      !OPERATIONAL_PATH.test(sourcePath) &&
      !projectPathHasSymlink(projectRoot, sourcePath);
  });
}

function isReadOnlyInvocation(tool, args) {
  if (!Array.isArray(args)) return false;
  const normalizedTool = String(tool || "").toLowerCase();
  const first = args[0];
  const second = args[1];

  if (normalizedTool === "node") return args.length === 1 && ["--version", "-v"].includes(first);
  if (normalizedTool === "npm") return args.length === 1 && ["--version", "-v"].includes(first);
  if (normalizedTool === "python" || normalizedTool === "python3") {
    return args.length === 1 && ["--version", "-V"].includes(first);
  }
  if (normalizedTool === "dotnet") return args.length === 1 && first === "--version";
  if (normalizedTool === "git") {
    return (first === "status" && args.slice(1).every((arg) =>
      ["--short", "--branch", "--untracked-files=no", "--porcelain"].includes(arg))) ||
      (first === "diff" && args.slice(1).every((arg) =>
        arg === "--no-ext-diff" || arg === "--no-textconv" || arg === "--stat" ||
        arg === "--" || !arg.startsWith("-"))) ||
      (first === "log" && args.slice(1).every((arg) =>
        ["--oneline", "--decorate", "--no-decorate"].includes(arg) ||
        /^-n\d+$/.test(arg) || /^--max-count=\d+$/.test(arg) ||
        !arg.startsWith("-"))) ||
      (first === "rev-parse" && args.length === 2 && second === "--show-toplevel") ||
      (first === "branch" && args.length === 2 && second === "--show-current") ||
      (first === "show" && args.slice(1).every((arg) =>
        arg === "--stat" || arg === "--no-ext-diff" || !arg.startsWith("-")));
  }
  if (normalizedTool === "codegraph") {
    return first === "status" && args.length === 1;
  }
  return false;
}

function assessToolInvocation(tool, args, options = {}) {
  if (options.requiresApproval === true) {
    return {
      requiresApproval: true,
      reason: options.reason || "This step is marked as requiring human approval.",
    };
  }
  if (isReadOnlyInvocation(tool, args)) {
    return { requiresApproval: false, reason: "Recognized read-only command." };
  }
  return {
    requiresApproval: true,
    reason: "The tool call is not on MCPEE's verified read-only allowlist; it may write files, change state, affect permissions, deploy, or send data externally.",
  };
}

function parseToolArguments(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { command: value };
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function shellCommandIsReadOnly(command) {
  if (typeof command !== "string" || /[|;&<>`\r\n]/.test(command)) return false;
  const normalized = command.trim().replace(/\s+/g, " ");
  return /^(?:git status(?: --(?:short|branch|porcelain|untracked-files=no))*|git diff(?: --(?:no-ext-diff|no-textconv|stat))*(?: -- [\w./:*?-]+)*)$/.test(normalized) ||
    /^(?:node|npm|python3?|dotnet) (?:--version|-v|-V)$/.test(normalized);
}

function assessCopilotToolCall(input, options = {}) {
  const toolName = String(input?.toolName || input?.tool_name || "").toLowerCase();
  const args = parseToolArguments(input?.toolArgs ?? input?.tool_args ?? input?.tool_input ?? input?.arguments);
  let requiresApproval = true;
  let reason = "This tool is not on MCPEE's verified read-only allowlist.";

  if (READ_ONLY_TOOL_CALLS.has(toolName)) {
    requiresApproval = false;
    reason = "Recognized read-only Copilot tool.";
  } else if (/^(?:bash|shell|powershell|terminal|run_in_terminal)$/.test(toolName)) {
    const command = args.command ?? args.cmd ?? args.script;
    const directoryListing = toolName === "powershell" && typeof command === "string" &&
      /^Get-ChildItem(?: -Force)?(?: \| Select-Object Name,Mode(?:,Length)?)?$/i.test(command.trim());
    if (directoryListing || shellCommandIsReadOnly(command)) {
      requiresApproval = false;
      reason = "Recognized read-only command.";
    } else {
      reason = "Shell commands require approval unless they match MCPEE's verified read-only allowlist.";
    }
  } else if (WRITE_TOOL_CALLS.test(toolName)) {
    reason = "This action is outside the task-scoped local file-write allowance and requires explicit human approval.";
  }

  if (!requiresApproval) return { decision: "allow", reason };
  if (options.taskScopedWrites === true && isTaskScopedLocalWrite(input, options)) {
    return {
      decision: "allow",
      reason: "Task-scoped in-project file change; per-file approval is not required.",
      taskScopedWrite: true,
    };
  }
  return {
    decision: options.nonInteractive ? "deny" : "ask",
    reason: options.nonInteractive
      ? `${reason} This session has no interactive human approval channel; the action was denied.`
      : reason,
  };
}

function formatApprovalArguments(args) {
  let redactNext = false;
  return args.map((arg) => {
    const value = String(arg);
    if (redactNext) {
      redactNext = false;
      return "[REDACTED]";
    }
    if (SECRET_ARGUMENT.test(value)) {
      const separator = value.indexOf("=");
      if (separator >= 0) return `${value.slice(0, separator + 1)}[REDACTED]`;
      redactNext = true;
      return value;
    }
    return value
      .replace(SECRET_ASSIGNMENT, "$1[REDACTED]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]");
  });
}

module.exports = {
  assessCopilotToolCall,
  assessToolInvocation,
  formatApprovalArguments,
  isTaskScopedLocalWrite,
  isReadOnlyInvocation,
  shellCommandIsReadOnly,
};
