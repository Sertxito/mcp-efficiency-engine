# Node.js engineering

**Scope:** Node.js services, libraries and tooling, not browser runtime assumptions.
**Version boundary:** inspect engines, package manager/lockfile, module system,
runtime flags and CI. Do not silently migrate CommonJS/ESM or upgrade Node.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Validate external input and preserve API/error contracts. Await or deliberately
  supervise promises; do not swallow rejections or keep an unhealthy process alive.
- Keep blocking CPU and synchronous I/O off request/event-loop paths where they
  affect latency. Bound concurrency; Promise.all is not a rate limiter.
- Use streams with backpressure for large payloads; cap input/output sizes,
  timeouts and queues rather than buffering an entire untrusted source.
- Propagate AbortSignal/cancellation where supported; close sockets, workers
  and child processes on completion or failure. Distinguish activity from progress.
- Spawn executables with argument arrays, shell disabled and explicit encoding;
  handle spawn, stdin, nonzero exit and signal failures independently.
- Preserve package exports, module resolution and environment contracts. Avoid
  runtime-generated shell commands, unreviewed scripts and secrets in logs.

## Lifecycle, boundaries and package contracts
- Distinguish JavaScript event-loop execution, libuv work and worker threads.
  A promise does not move CPU-heavy parsing, regex or serialization off the
  event loop; reject oversized input and choose workers only with evidence.
- Supervise event listeners and timers; remove them on teardown and handle
  error events on the actual emitting resource. Use stream pipeline/completion
  helpers where supported instead of assuming an end event proves every stage
  succeeded.
- On shutdown, stop accepting work, drain in-flight operations within a deadline
  and close owned resources. Preserve failure exit status; do not treat an
  uncaught exception as a safe point to continue serving.
- Validate required configuration at startup. Keep secrets server-side, resolve
  filesystem paths against an intentional root and constrain user-selected paths;
  normalization alone does not authorize a path or prevent symlink escape.
- Keep public exports, declaration files, runtime dependencies and lockfiles
  coherent. Test the packed package where exports/build output matter; do not
  rely on development-only dependencies being present in production.
- For HTTP services, bound bodies and deadlines, validate proxy/CORS assumptions
  and enforce authorization server-side. Make retry and duplicate request
  behavior explicit; process-local memory is not shared durable state.

## Verification and performance
Use project-declared lint/typecheck/tests/build. Test timeout, cancellation,
backpressure and process failure paths when touched.
Use Node CPU/heap profiling and event-loop delay measurements to distinguish
CPU saturation, allocation/GC, I/O waits and blocked callbacks. Capture payload
size, concurrency, warmup and latency distribution before changing algorithms,
worker placement or caching. Redact sensitive data in profiles.

Official references:
- https://nodejs.org/api/
- https://nodejs.org/api/stream.html
- https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
- https://nodejs.org/api/inspector.html
