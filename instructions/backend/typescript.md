# JavaScript and TypeScript engineering

**Scope:** Shared JavaScript/TypeScript practices in backend and frontend code;
framework and Node.js runtime rules are separate.
**Version boundary:** inspect runtime/browser support, transpiler and package
targets. For TypeScript, use the repository's compiler, lib, module and
moduleResolution settings; do not raise targets or loosen strictness silently.
**References checked:** 2026-10-20 (reference selection, not runtime certification).

## Practices
- Preserve JavaScript value semantics: distinguish missing, null, false, zero
  and empty string rather than masking all with a truthy fallback. Use strict
  equality unless intentional coercion is documented by the existing contract.
- Keep object/prototype ownership explicit, do not mutate shared inputs
  unexpectedly, and avoid eval or unsafe merging of untrusted property keys.
- Handle rejected promises, cancellation and cleanup; event-driven code must
  not treat a scheduled operation as a completed success.
- Follow the existing formatter/linter and module conventions. Use JSDoc where
  the JavaScript project already checks it; do not migrate to TypeScript silently.

## TypeScript-specific practices
- Narrow unknown input with guards or existing schema validators; static types
  do not validate JSON, environment variables, HTTP responses or persisted data.
- Prefer discriminated unions, explicit boundary types and exhaustive handling.
  Do not hide uncertainty with any, double casts or non-null assertions.
- Preserve null/undefined semantics, optional fields and serialization behavior.
  Use readonly/immutable boundaries where appropriate without pretending they
  freeze runtime objects.
- Keep generics proportionate to actual reuse; avoid types that obscure runtime
  behavior or force callers into assertions.
- Respect ESM/CommonJS, type-only imports and package exports. Avoid accidental
  server-only imports in browser bundles and circular initialization.

## Data flow and API design
- Prefer explicit domain states over boolean combinations that permit invalid
  states. Keep enum/union wire values compatible and handle unknown future
  external values deliberately rather than assuming an exhaustive local type
  validates a remote producer.
- Understand reference aliasing and shallow spread/copies. Use stable keys for
  maps/sets and do not confuse an omitted property with one set to undefined.
  Avoid prototype-sensitive lookups for untrusted dictionaries.
- Preserve numeric precision at boundaries: JavaScript numbers cannot represent
  all large integer IDs, BigInt is not JSON-serializable by default, and decimal
  money needs the project's explicit representation/rounding strategy.
- Distinguish timestamp instants from local calendar/time-zone values. Parse and
  serialize using explicit contracts, not machine locale assumptions.
- Keep promise chains awaitable and error paths observable. Avoid async forEach
  and unbounded Promise.all for rate-limited work; use intentional sequencing or
  bounded concurrency. Clear listeners/timers when ownership ends.
- Maintain public type declarations alongside runtime behavior. Test optional
  fields, malformed input and emitted exports; avoid leaking internal types or
  creating circular imports for type reuse.

## Verification and performance
Run the existing typecheck and production build as well as runtime tests for
boundary validation and error paths. A green compiler is not a runtime test.
Inspect emitted/bundled output when an import or abstraction affects payload
size; do not claim runtime improvements from type-only changes.

Official references:
- https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- https://www.typescriptlang.org/tsconfig/
- https://www.typescriptlang.org/docs/handbook/2/objects.html
