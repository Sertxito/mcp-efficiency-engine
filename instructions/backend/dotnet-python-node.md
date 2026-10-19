# Backend engineering: .NET, Python, and Node.js

**Scope:** application code and runtime/toolchain choices for these three
ecosystems. **Version boundary:** this guide certifies no particular runtime or
framework release; use the project's declared support range and verify
version-sensitive APIs against the official references below. **References
checked:** 2026-10-12 (HTTP reachability only, not a review of every page's
technical content).

Detect the actual language/runtime and target version from project files and
CI. Follow local architecture and conventions first. Resolve version-dependent
questions with official documentation and report the version checked.

## .NET / C#

- Keep API contracts, validation, authorization, error semantics, async
  cancellation, disposal, and dependency-injection lifetimes explicit.
- Follow repository naming and `.editorconfig`; where absent, use Microsoft's
  C# conventions as a baseline. Preserve public and serialized compatibility.
- Use configured Roslyn analyzers, formatters, build, and tests as the source of
  automated style evidence.

## Python

- Follow the project's supported Python floor, packaging metadata, formatter,
  and type-checker. Prefer explicit interfaces, predictable exceptions, and
  tests for failure behavior.
- Keep I/O, concurrency, dependency injection, and resource lifetimes aligned
  with the project's framework rather than imposing a new architecture.

## Node.js

- Follow `engines`, lockfile, module system, and supported Node LTS range.
- Preserve async error propagation, input validation, and explicit resource
  cleanup. Do not use shell interpolation for process execution.
- Validate with declared lint, typecheck, tests, and production build.

Official references:
- C# conventions: https://learn.microsoft.com/dotnet/csharp/fundamentals/coding-style/coding-conventions
- .NET analyzers: https://learn.microsoft.com/dotnet/fundamentals/code-analysis/overview
- Python tutorial: https://docs.python.org/3/tutorial/
- Python packaging: https://packaging.python.org/en/latest/
- Node.js API documentation: https://nodejs.org/docs/latest/api/
- Node.js best practices: https://nodejs.org/en/learn/getting-started/nodejs-the-difference-between-development-and-production
