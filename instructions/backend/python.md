# Python engineering

**Scope:** Python applications, libraries, services and scripts.
**Version boundary:** inspect requires-python, interpreter, lockfiles, framework
and CI matrix; preserve the supported Python floor.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Follow the package layout and declared formatter/linter/type checker. Avoid
  sys.path hacks, import-time side effects and undeclared global dependencies.
- Use explicit interfaces, type annotations and narrowing at boundaries; avoid
  Any or ignored diagnostics as substitutes for verified types.
- Model mutable defaults correctly; keep shared state and ownership explicit.
  Use context managers for files, connections, locks and temporary resources.
- Catch specific exceptions at the layer that can handle them, retain causes,
  and propagate failures instead of returning success-shaped empty results.
- Distinguish CPU work from I/O. Do not block an async event loop; use bounded
  executors/queues where appropriate and preserve cancellation and cleanup.
- Specify encoding at text/process boundaries, serialize structured payloads
  explicitly, and reject invalid data rather than silently replacing it.
- Keep SQL parameterized and subprocess arguments separate from shell text.
  Do not deserialize untrusted pickle or enable model remote code implicitly.
- Pin dependencies through the existing packaging workflow. Test the declared
  interpreter/environment, not an assumed global Python installation.

## Data, boundaries and maintainability
- Prefer cohesive functions/modules and explicit dependencies to import-time
  singletons. Choose dataclasses/value types where useful; annotations alone
  do not validate runtime payloads or make mutable fields immutable.
- Use `is None` when checking absence, not truthiness when zero/False/empty are
  valid values. Understand aliasing, shallow copies and iterator exhaustion;
  choose list/set/dict/generator from access and memory needs.
- Keep money/precision and aware timestamp/time-zone semantics explicit.
  Do not mix naive/aware datetimes or inherit locale-dependent parsing.
- Use parameterized logging rather than eagerly constructing sensitive messages.
  Libraries should not configure global application logging during import.
- Keep resource ownership in context managers, including generator/async cleanup.
  Await tasks or supervise their failure; preserve cancellation rather than
  swallowing it with broad exception handling. Limit task and queue growth.
- Do not assume the GIL makes multi-step shared-state operations safe or that
  threads speed CPU-bound Python work. Choose concurrency for the supported
  interpreter/build and workload, with explicit shutdown and isolation.
- Test public behavior with deterministic fixtures, temporary paths and patched
  external boundaries where appropriate. Include installed-package/import
  behavior; passing tests from the source tree alone does not validate a wheel.

## Verification and performance
Run focused declared tests and configured type/lint checks, including failure,
Unicode, resource-cleanup and concurrency behavior where relevant.
Use cProfile or a project-approved sampler for CPU/call attribution and
tracemalloc for Python allocation questions; distinguish native memory from
Python heap measurements. Measure a bounded workload with warmup and repeats;
do not infer a leak from one RSS reading or a speedup from one timing.

Official references:
- https://docs.python.org/3/library/typing.html
- https://docs.python.org/3/library/asyncio.html
- https://docs.python.org/3/library/profile.html
- https://docs.python.org/3/library/tracemalloc.html
- https://packaging.python.org/en/latest/
- https://docs.python.org/3/tutorial/datastructures.html
- https://docs.python.org/3/tutorial/errors.html
