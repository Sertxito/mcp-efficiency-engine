# C# and .NET engineering

**Scope:** C# application, service and library code.
**Version boundary:** inspect target frameworks, SDK/global.json, nullable
settings, package pins and analyzers; never assume the latest API is supported.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Preserve public, HTTP and serialized contracts. Validate untrusted input at
  boundaries; keep domain rules outside transport and persistence plumbing.
- Use nullable annotations, exhaustive handling and meaningful domain types;
  avoid null-forgiving operators or casts that conceal an invalid invariant.
- Use async I/O end to end; pass CancellationToken through supported operations.
  Avoid `.Result`, `.Wait()` and async void outside event-handler contracts.
- Match DI lifetimes; never capture scoped state in singletons. Dispose owned
  resources with using/await using; reuse configured HTTP/database clients.
- Define transaction and retry boundaries explicitly. Retries require bounded
  attempts, cancellation and idempotency; do not retry authorization failures.
- For EF Core, inspect generated SQL, projections, tracking and pagination;
  detect N+1 queries before adding eager loads or caching. Avoid loading an
  unbounded table to filter in memory.
- Preserve structured logging and exception context without exposing secrets.
  Return explicit error semantics; do not convert failed operations to success.
- Follow the repository's naming/analyzer/.editorconfig and API documentation
  requirements. Prefer appropriate domain names over abbreviations; do not
  override an established convention with a generic style preference.
- For ASP.NET APIs, review supported Problem Details/error conventions, object/
  tenant authorization, input binding and OpenAPI/client compatibility.
- For existing Razor/WPF/MAUI code, inspect the relevant host/UI lifecycle,
  binding/encoding and thread-affinity rules; consult dotnet-legacy-runtime.
  These are conditional contexts, not a reason to migrate every service to UI
  patterns or a newer framework.

## Dependency injection and composition
- Prefer constructor injection for required collaborators. Avoid service
  locators, static containers and resolving business dependencies through
  IServiceProvider; inspect legitimate framework integration boundaries.
- Keep application composition at the host boundary, not inside business
  classes. Follow approved team choices for registration organization, container
  and discovery; do not impose Add{Feature}, assembly scanning or a new container
  as universal requirements.
- Singletons must be thread-safe. Background workers using scoped dependencies
  create and dispose an explicit scope per unit of work; verify context lifetime
  against the actual operation rather than assuming every host is HTTP.
- Do not dispose dependencies owned by the container or create a duplicate
  container with BuildServiceProvider during normal service registration.
  Inspect ownership of explicitly created instances and factory results.
- Introduce interfaces, factories or mediators for meaningful boundaries and
  substitution needs, not mechanically one per class.
- Verify registrations, required options, disposal and affected scope paths
  through the project's startup/composition tests. Where supported, scope/build
  validation helps detect lifetime errors but does not cover every factory path.

## Types, collections and contracts
- Use cohesive types and explicit invariants. Choose records/value objects for
  suitable value semantics, not as a blanket replacement for mutable entities.
  Keep equality and hash codes consistent; do not mutate dictionary/set keys.
- Preserve public signatures, defaults and serialized names. Separate transport
  DTOs from persistence entities when exposing entities would leak fields or
  couple public contracts to storage. Avoid mass assignment of privileged fields.
- Use explicit string comparison for identifiers and protocol values, normally
  ordinal where the contract requires it; use culture-aware formatting for users.
  Select decimal precision/rounding for money and explicit offset/time-zone
  semantics for timestamps; never infer a business time zone from server locale.
- Understand LINQ deferred execution, query translation and enumeration cost.
  Materialize at an intentional boundary; do not repeatedly enumerate an
  expensive sequence or return a lazy query tied to a disposed context.
- Prefer readable code and existing analyzers over universal style mandates.
  Use newer syntax only within the supported language/runtime range; do not
  introduce unsafe code, pooling, Span or custom allocation tricks without need.

## Async, concurrency and failure handling
- Await and observe tasks; supervise background work with the host lifecycle,
  rather than fire-and-forget request work. Do not wrap asynchronous I/O in
  Task.Run to make it appear nonblocking, or assume that async implies parallelism.
- Bound fan-out and queue growth. Protect shared mutable state with appropriate
  synchronization; do not hold a synchronous lock across an await or assume a
  concurrent collection makes a multi-step business operation atomic.
- Preserve cancellation as cancellation, not an empty success or arbitrary 500.
  Catch specific exceptions only where recovery or meaningful translation is
  possible. Rethrow with `throw;` to preserve the stack; retain inner causes when
  wrapping. Do not use exceptions for routine parsing or expected lookup misses.
- Apply timeouts and transient retries at a deliberate boundary; consider the
  combined retry budget across HTTP, SDK and database layers. A retry after an
  ambiguous write can duplicate effects unless the operation is idempotent.

## EF Core and persistence
- A DbContext is a short-lived unit of work and is not thread-safe. Await its
  operations before reuse; do not run parallel queries on the same instance.
  Use separate contexts only when transaction and consistency requirements allow.
- Project only required columns; use no-tracking for genuinely read-only entity
  work where identity/change tracking is not needed. Review eager loading, split
  queries and their consistency/round-trip trade-offs instead of enabling them
  globally to hide N+1 or cartesian growth.
- Keep filtering, ordering and pagination server-side where supported; review
  generated SQL and provider behavior before materializing. Use deterministic
  ordering, bounded pages and an appropriate seek/offset strategy.
- Handle optimistic concurrency conflicts explicitly. Keep transactions short
  and make SaveChanges, external side effects and retry boundaries coherent;
  use an approved outbox/idempotency pattern when atomic cross-system effects
  cannot be guaranteed. Do not add a repository or outbox mechanically.
- Review migrations for data loss, locks, backfills and rolling compatibility.
  Test provider-specific query/constraint behavior on the actual database
  provider; EF's in-memory provider does not prove relational correctness.

## Hosting, configuration and diagnostics
- Bind configuration through the project's typed options/validation patterns;
  reject invalid required settings before handling traffic where appropriate.
  Do not log configuration secrets or introduce a second configuration source.
- Reuse configured HTTP clients/handlers with the project's lifetime strategy.
  Review connection pooling, DNS changes, cancellation and resilience rather
  than creating/discarding a new client per request.
- Keep structured message templates, correlation and useful error context.
  Avoid logging the same exception at every layer or exposing stack traces and
  sensitive payloads in responses. Distinguish liveness from dependency readiness.
- Test authorization, malformed input, serialization, cancellation, concurrency,
  startup options and resource cleanup as relevant; use deterministic clocks/
  fixtures and real integration boundaries rather than mocking every call.

Team conventions supply local choices and paths, not a replacement copy of these
practices. Missing preferences are not automatically blockers: inspect existing
patterns and use compatible defaults. Ask when a consequential decision is
unresolved or mandatory rules conflict; do not invent organizational policy.

## Verification and performance
Use the existing dotnet build/test and configured analyzers with the intended
framework/configuration. Test cancellation, validation and failure paths.
Use dotnet-counters/trace or an approved profiler to distinguish CPU, GC,
allocation, thread-pool starvation and database waits. BenchmarkDotNet is
appropriate only if already available or separately approved; compare Release
builds, representative data, warmup and equivalent environments.

Official references:
- https://learn.microsoft.com/dotnet/csharp/fundamentals/coding-style/coding-conventions
- https://learn.microsoft.com/dotnet/core/diagnostics/
- https://learn.microsoft.com/ef/core/performance/efficient-querying
- https://learn.microsoft.com/aspnet/core/web-api/handle-errors
- https://learn.microsoft.com/dotnet/csharp/asynchronous-programming/async-scenarios
- https://learn.microsoft.com/dotnet/standard/exceptions/best-practices-for-exceptions
- https://learn.microsoft.com/ef/core/dbcontext-configuration/
