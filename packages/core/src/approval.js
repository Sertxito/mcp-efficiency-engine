"use strict";

const READ_ONLY_TOOL_CALLS = new Set([
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
    reason = "File writes and state-changing tools require explicit human approval.";
  }

  if (!requiresApproval) return { decision: "allow", reason };
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
  isReadOnlyInvocation,
  shellCommandIsReadOnly,
};
