For C# and .NET changes, inspect the target framework, neighboring code,
`.editorconfig`, `Directory.Build.props`/`targets`, analyzer packages, and CI
commands before applying conventions. Existing repository policy takes
precedence over defaults.

1. Follow the project's naming rules. Where none exist, use Microsoft's C#
   conventions as a baseline: PascalCase for public types and members,
   camelCase for parameters and locals, and established interface/attribute
   conventions. Do not rename public APIs or serialized members without
   checking compatibility.
2. Keep nullability, async behavior, cancellation, exception semantics,
   disposal, and dependency-injection lifetimes consistent with the code's
   contracts. Do not add these mechanisms mechanically where they do not apply.
3. Prefer clear, cohesive methods and explicit domain behavior over
   speculative abstractions, hidden side effects, or duplicated policy.
4. Validate with the repository's declared `dotnet` build, test, formatter, and
   analyzer commands. Use `dotnet format` only in the scope and mode supported
   by the project; do not silently apply repository-wide formatting.
5. Report missing analyzers or checks as an enforcement gap rather than
   claiming that conventions were automatically enforced.

Reference material:
- https://learn.microsoft.com/dotnet/csharp/fundamentals/coding-style/coding-conventions
- https://learn.microsoft.com/dotnet/fundamentals/code-analysis/overview
- https://learn.microsoft.com/dotnet/fundamentals/code-analysis/configuration-files
