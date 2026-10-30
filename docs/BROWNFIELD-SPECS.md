# Brownfield specification discovery

MCPEE creates reviewable proposals by candidate domain from an existing
project's indexed sources. Discovery is deterministic and local: it records
source paths, SHA-256 hashes, extracted headings and symbols, supported C#
validation/route/authorization declarations, and declared test names. It
does not execute tests, infer business intent, send source content to a model,
or declare observed code to be desired behavior.

## Functional authoring versus static inventory

Static discovery is not a functional specification. In Copilot Chat, request
"Draft functional specifications from `<indexed product sources>`; do not
implement yet." Spanish requests such as "Prepara las especificaciones
funcionales" and short "greenfield" / "brownfield" requests also select this
authoring path. The product agent is preferred when installed; requirements
discovery guidance is included even when document or frontend keywords occur.

The internal executor reads the selected sources and returns a structured
draft. MCPEE validates non-empty actors, use cases, main flows, alternatives,
postconditions, rules, Given/When/Then criteria and exact source-line quotes.
Each supplied top-level source section must be mapped to use cases or explicitly
deferred/excluded with a reason. The checked draft is rendered as readable
Markdown as an index under `docs/specifications/<descriptive-slug>.md`, with
one self-contained `docs/specifications/<descriptive-slug>/UC-001.md` file per
case and a machine-readable `manifest.json`. The index links to all cases.
Each case has one explicit actor goal, local decisions still open, and
prerequisite case references; missing, self-referencing or cyclic dependencies
are rejected. The manifest binds case content hashes, source hashes and
coverage. It records unresolved decisions and does not claim implementation
readiness. The JSON model response is not the human deliverable.
Existing different content in any bundle file is never overwritten; conflicts
are checked before creating the bundle. Use a new descriptive revision slug
after review.

## Generic documentation-to-atomic-greenfield process

This path applies to any documentation-only project; it is not specialized for
a named product. Initialize MCPEE, provide product documentation and synchronize.
Then request the greenfield process, stopping at atomic use-case specifications:

1. **Verify inputs.** Inventory the indexed product documents, their conversion
   state and hashes. Explicit source paths restrict the requested scope;
   otherwise include all product business, architecture, documentation,
   contract and decision sources. Do not silently use the first five search
   results. Unconverted/failed documents in scope block authoring before
   model execution. More than 100 documents or 2 MiB of source text requires an
   explicitly narrower scope.
2. **Establish product boundaries.** Derive outcomes, actors, scope, non-goals,
   shared constraints and unresolved decisions from those sources.
3. **Decompose by goal.** Separate independently useful actor goals, not merely
   pages or technical modules. Express only real prerequisite relationships
   as case dependencies.
4. **Specify each case.** Define trigger, preconditions, numbered normal flow,
   alternatives, postconditions, rules, observable acceptance criteria and
   exact source-line quotes. Missing visual references are disclosed as gaps;
   no visual assets or visual validation are claimed to exist.
5. **Validate and persist.** Check structure, case references, quotes, hashes
   and declared source-section coverage, then save the index and individual
   documents. Atomic files and a complete source mapping are not proof of
   semantic atomicity or completeness; a human must review the decomposition.
6. **Hand off for review.** Present unresolved decisions and deferred sections.
   Fill matching source-bound review proposals without approving requirements
   or starting implementation.

These are authoring stages within one bounded model attempt, not a claim that
several independent specialist agents executed. The executor remains read-only;
MCPEE performs validated artifact persistence. A documentation-only authoring
request does not query or require an application CodeGraph index. Plain npm-init
metadata also does not by itself establish an application implementation.

## Draft review handoff

Matching source-bound discovery proposals have their empty behavior and
acceptance prompts filled from the validated cases, without manual copying.
The executor returns their paths and current review digests. Existing reviewed
text is preserved; no approval happens automatically. A case citing sources
outside a proposal is not copied into it: cross-domain approval needs a
deliberately reviewed evidence boundary, not an unbound requirement.

Missing sources fail before the SDK starts. Invalid output or sources changing
during execution fail the run rather than reporting template generation as a
completed specification. There is one authoring attempt per run, not an
automatic paid repair loop. These structural and provenance checks cannot
prove semantic completeness, correctness, runtime behavior or owner approval.
Source sections marked deferred remain visible review gaps.
Converted Office/PDF/image sources use their current indexed normalized text
for line citations; both that text and the original source hash are rechecked
before saving. Missing or stale document conversion blocks authoring before
the SDK starts instead of decoding binary bytes as business requirements.

MCPEE-only dependency manifests, configuration and generated integration files
are excluded from product evidence. Static discovery no longer adds generic
valid/invalid-input scenarios to inflate its case catalog; only source-derived
test declarations, validation/auth declarations and recognized implementation
observations contribute cases. A source without those facts has zero extracted
test cases, not four purported business cases.

`mcpee init` creates the first local proposals under
`.mcpee/specs/proposed/` after the initial source sync when eligible sources
exist. Drafts and extraction evidence stay in MCPEE-managed state until a
reviewer ratifies one. Later source changes are reported as drift; neither
`sync` nor `specs discover` rewrites an existing proposal or an approved
specification. A changed source snapshot produces a new proposal with a
different snapshot-based ID. Earlier drafts and monolithic baselines remain
available for provenance; they are not overwritten or silently deleted.

## Single-command onboarding

Run `mcpee init --project <path>` once. The same built-in pipeline applies to
TR and any other existing project: initialize managed state, inventory configured
source roots, extract indexed evidence, partition candidate domains, and create
proposals, characterization scenarios, assertion records and readable catalogs.
No separate `specs discover` call, per-domain invocation, or repeated `init`
is needed to obtain this extraction. Tool installation can require approval;
`--skip-tool-install --embeddings none` uses existing tools and skips optional
embedding setup, not mandatory tool readiness checks.

The CLI prints the review index and extraction counts. Both the index and
`.mcpee/specs/latest.json` record coverage: indexed/included sources, excluded
sources with reasons, supported/unsupported implementation-recognition files,
observations, declared tests and associated assertions. Per-family capabilities
and limitations are also recorded, always as `static-syntax-partial`, not
complete semantic coverage. Unsupported files are explicitly listed as gaps.
Recognized files categorized as infrastructure still receive implementation
recognition.
Office documents in business/architecture folders retain their domain category
but use the document processor selected by extension. Without an invokable
converter they are reported as requiring a tool, never treated as plain text
or silently included as extracted requirements.

Use `mcpee sync` after source changes. The common synchronization engine refreshes
the inventory and specification proposals together, including the approved
post-change maintenance path after Copilot edits. Unchanged evidence preserves
existing drafts, including owner edits; changed evidence creates a new snapshot
without changing approved contracts. `specs discover` is an optional explicit
re-extraction of the current inventory, not a required second command.
Repeat `init` to retry reported installation failures or refresh installation
configuration, not to finish an incomplete discovery loop. Neither init nor
discovery executes application tests, starts project services or ratifies
business requirements.

## Greenfield acceptance path

An empty project has no implemented behavior to reverse-engineer. Installing
MCPEE as its only dependency does not change that. Start with written requirements:

1. Run `mcpee init --project <path>`.
2. Write requirements in an indexed project Markdown file, with concrete inputs,
   observable outcomes, non-goals and unresolved decisions.
3. Run `mcpee sync --project <path>`, then request a functional draft in Copilot
   using the requirements document's exact path. Review the readable document
   in `docs/specifications/`, not just the static inventory. Review the
   automatically filled matching proposals and their returned digests.
4. Ratify the exact reviewed digest using the normal explicit reviewer command.
   Routing includes the approved contract in subsequent execution context.
5. Implement the agreed slice and its tests, with the ordinary execution/tool
   approvals. Run the project's tests/validation workflow.
6. Run `mcpee sync`, or approve post-change maintenance when using the Copilot
   execution flow. Implementation evidence is discovered automatically; approved
   requirements remain untouched.

The local acceptance test covers empty initialization, requirement discovery,
explicit fixture-owner ratification, routing/context, a deterministic invoice
implementation, two genuinely executed tests, automatic refresh and drift after
a requirement changes. It uses a CodeGraph contract fixture and does not
represent an authenticated model coding run. SDK prompt delivery and integrity
are separately tested with a mocked client. Product review is never replaced
by these automated fixture approvals.

Drift is source-hash based for files bound to a contract; a newly added file
does not itself mark that contract as drifted. New files do enter current
proposals. Semantic disagreement or coverage of new implementation requires
review and executable checks; a `current` hash result is not compliance proof.

## Readable domain review

`specs discover` prints an entry-point Markdown index under
`.mcpee/specs/reviews/<snapshot>/index.md`. Open that index rather than the JSON
manifest. It links to one navigation page per candidate domain and then to
small review documents with:

- intended behavior and acceptance criteria awaiting owner decisions;
- observed contract declarations with file and line references;
- a readable test-case matrix and links to a complete paginated Markdown
  case catalog (at most 40 rows per page);
- unknowns, unverified coverage, and a source map.

Directory names under `features`, `modules`, `domains`, `core`, `requests`
and `responses` provide initial grouping anchors. Repeated filename families
and matching prefixes associate other source files. Infrastructure,
migrations, documentation and unmatched shared code have separate technical
areas. These are explainable heuristics, **not inferred business semantics**:
different components with the same name can be grouped, and synonyms or
translated names are not automatically merged. Confirm boundaries and
cross-domain relationships during review.

Each review document has at most 20 source files. Larger domains are split
into parts. Long observation lists and case tables have explicit previews;
every case remains available in the linked Markdown catalog, while detailed
hashes remain in per-proposal evidence JSON.

`specs list` and `specs drift` consider current discovery drafts and all
approved specs. `specs list --all` also inventories archived drafts.
`.mcpee/specs/latest.json` identifies the current discovery set; an edited or
unowned state/index is rejected rather than overwritten.

## Test cases: declaration versus execution

- `declared`: a supported JS/TS, Python, C# or Pester test declaration was found.
  Inspect its assertions; a name alone does not establish behavior or coverage.
  Explicit JS/TS `skip`/`todo` declarations are marked `disabled-not-run`.
- `negative-candidate`: proposed invalid-input or dependency-failure scenario.
  Supported `Required`/`EmailAddress` declarations provide field-specific
  evidence. Supported `Authorize` annotations also suggest missing-identity
  and wrong-role/policy cases, not proof of effective runtime access control.
- `boundary-candidate`: proposed below/at/above-limit checks from supported
  length/range declarations, or an explicit request to identify actual limits.
- `positive-candidate`: representative normal behavior still requiring an
  owner-confirmed input and observable result.
- `implementation-candidate`: a return/throw lexically inside supported
  `if` conditions in product code. The cited expressions come from the
  implementation; they are characterization-test starting points, not
  a proven path, an approved requirement or an executed check.

Case kind is not an implementation status. Three independent columns distinguish:

- **Product behavior:** `observed-declaration` identifies an existing, cited
  validation or authorization declaration in product code, not proven runtime
  enforcement. `observed-syntax` identifies an implementation-derived scenario,
  without establishing reachability. `not-assessed` makes no claim about implementation, including
  for test names and generic scenarios.
- **Test automation:** `declared` or `declared-disabled` identifies an existing
  test declaration. `not-assessed` means no coverage relationship has been
  established or ruled out; it does **not** mean a test is missing.
- **Execution:** `not-verified` means no verified result for an existing test;
  `disabled-not-run` identifies an explicitly disabled test;
  `not-run-by-discovery` means extraction did not execute a proposed scenario.

Discovery does not execute tests or infer coverage links from similar names.
Generic scenario source links provide context, not implementation evidence.
No candidate status asserts that product functionality or automation is absent.
Review applicability, fixtures, exact expected outcomes and side effects;
write approved criteria in the main proposal before changing implementation.
Static recognizers intentionally
cover only simple declarations; dynamic tests, multiline attributes, custom
validators and business logic need inspection. They are not semantic parsers.

## Implementation and assertion evidence

### Product stack coverage

The agreed product scope is C#/.NET, JavaScript/Node.js, TypeScript, Python,
SQL, PowerShell, Bicep, pipeline YAML, HTML/Angular templates and React/JSX/TSX.
Vue and other languages are not part of this recognition scope. Coverage does
not depend on TR: the CLI acceptance fixture contains all ten families under
independent source roots, and checks first-init extraction and repeat preservation.

| Family | Static evidence | Test association | Explicit limits |
| --- | --- | --- | --- |
| C#/.NET | Supported attributes, methods, lexical conditions, calls, returns, exceptions, assignments and assertions | Simple annotated block-bodied methods | No compiler/type/DI resolution, inherited policies or full LINQ/data flow |
| JavaScript/Node.js | Lexical conditions, calls, returns, exceptions, assignments and assertions | Simple `it`/`test` callbacks | No runtime module resolution, complete AST or async execution graph |
| TypeScript | Same script observations, with simple typed methods | Simple `it`/`test` callbacks | No type checker, overload resolution or complete decorator analysis |
| React/JSX/TSX | Script observations plus JSX element and event-binding syntax | Supported script test callbacks | No rendered tree, resolved components or hook lifecycle |
| Python | Indented functions and conditions, calls, returns, raises, assignments, context managers, await and asserts | Simple `test_` function bodies, including `self.assert*` syntax | No dynamic dispatch; tabs, nested definitions and multiline suites may remain unassociated |
| SQL | DDL, constraints, queries, mutations, procedure calls and transaction statements | Not associated | No dialect catalog, procedure flow, transaction or persistence proof |
| PowerShell | Functions, parameters, commands, conditions, returns, exceptions and selected state commands | Simple Pester `It` scriptblocks and `Should` statements | No pipeline/module binding or runtime side-effect proof |
| Bicep | Parameters, resources, modules, outputs, constraints, conditions and explicit dependencies | Not associated | No compiler/provider validation or evaluated/deployed resource graph |
| Pipeline YAML | Job/stage/step structure, conditions, dependencies, actions and command declarations | Not associated | Known pipeline paths only; no YAML/template/action expansion or command execution |
| HTML/Angular | Form/event/property bindings and template-control syntax, including multiline tags and multiple tags per line | Not associated | No component resolution, rendered behavior or accessibility verification |

This is bounded source evidence, not full semantic support. Each family has
positive and negative recognition fixtures; the index exposes the same capability
descriptions programmatically in `coverage.language_capabilities`. Infrastructure
and declarative evidence does not fabricate test cases or claim execution.

### Explicit relationships between sources

`init` and `sync` build the unified source graph **before** discovering
specifications. Discovery reuses its resolved, explicit local references instead
of inventing a second resolver. Import relationships from JS/TS/Python tests are
labelled `tests_source`; other supported links include local document, project,
schema, module, pipeline action and package references when the graph resolves
them to an included source file. Dynamic, ambiguous and non-source targets are
not promoted to source relationships.

The observation catalog links both the origin line and target file. Evidence
retains the relationship type and both source hashes; approved contracts detect
changed or missing referenced targets even when those targets belong to another
domain or proposal part. A `tests_source` reference proves only an explicit import:
it does **not** prove a call, assertion-to-function mapping, behavioral coverage,
test execution or a passing result.

`coverage.source_relationships` reports availability and extracted relationship
count. Standalone discovery without a graph explicitly reports `not-available`;
an existing graph that is missing an included source or has stale source hashes
fails with a request to synchronize, rather than silently reporting current
relationships.

Proposals link to a complete, paginated observation catalog (at most 40 rows
per page), not just an observation preview or JSON. For JS/TS and C# source,
discovery recognizes control-flow statements, returns, throws, catch blocks,
assignments, dotted call sites, selected persistence/storage operation calls
and common `expect`/`assert`/`Assert` assertion syntax. Records include redacted
source text, file/line citations, simple enclosing method labels when recognized,
and lexical enclosing `if` conditions. Conditional scenarios are generated
only from product source, not from test assertions.

Supported block-bodied JS/TS callbacks, simple C# annotated methods, Python
`test_` functions and Pester `It` scriptblocks carry their own assertion
records, bounded by braces or Python indentation. Assertions from neighboring tests
or setup blocks are not treated as that test's checks. `block-inspected` means
the supported body was inspected, including when no assertion was recognized;
`unsupported-body` means no reliable association was made. Neither establishes
test quality, actual coverage, invocation of an assertion, or a passing result.
Exact assertion expressions remain readable in the observation catalog.
Explicit supported skip declarations in C#, Python and Pester retain disabled
automation status. Conditional skips are not evaluated or presumed disabled.
Code-derived cells escape Markdown metacharacters so example links, backticks
and pipes in source literals do not become navigation or extra table columns.

Recognition masks comments and quoted literals, including template bodies;
common regex literals are masked too. This is deliberately conservative static
evidence, not an AST/type checker, complete language parser, call graph or
control-flow graph. Multiline statements, expression-bodied functions, regex
ambiguities, interpolation, custom assertions, inherited behavior and dynamically
dispatched calls require further inspection. An `else` outcome is not inferred
as the inverse of an `if`. Guards do not cross recognized nested callable
boundaries; mixed conditional and unconditional outcomes on the same line do
not produce an asserted common guard. Python continuation lines are not treated
as new indentation scopes. Pipeline prose block scalars are not script bodies;
template attribute values are not additional attribute declarations.
Operation names alone do not prove persisted effects,
transactionality or runtime access enforcement.

Observation catalogs are bound to the proposal snapshot, checked before
ratification and copied alongside approved specs. New relationship evidence uses
format 8; format 9 removes generic cases and identifies inventories explicitly.
Historical format-4/5/6/7/8
catalogs remain verifiable without being rewritten or upgraded in place.

## Review and approval lifecycle

1. Open the index printed by discovery and choose a domain/part.
   Run `mcpee specs list` to find its current SHA-256.
2. Review `.mcpee/specs/proposed/<id>.md` and the linked case catalog. Replace the
   behavior and acceptance-criteria prompts with owner-confirmed, testable
   statements; record unresolved questions and relevant check results.
3. Run `mcpee specs ratify --slug <id> --reviewer "<name>" --confirm-sha256 <digest>`.
   The digest must match the exact reviewed Markdown file. Ratification is
   rejected while the prompts remain or any referenced source has changed or
   disappeared since the indexed snapshot. The snapshot reference also binds
   the evidence/case records; editing generated case pages or removing source
   references from their manifest cannot bypass the review.
4. Approved specifications and their source-hash manifest are created
   exclusively under `specs/approved/<id>/`. Existing files are never
   overwritten. The complete case catalog is copied alongside the approved
   spec, with working links. `mcpee specs drift` checks current proposals and approvals
   against current on-disk source hashes; it never repairs or rewrites them.

The approved Markdown is the normative, versionable specification. The
evidence JSON records reviewer, approval time, proposal digest, and source
hashes. Approval is an explicit human attestation, not proof that the
reviewer's assertions are correct. Editing an approved specification is a
normal version-control change and requires review through the project's
ordinary governance process.

Routing plans include approved specification paths and hashes. Their actual
Markdown content is added before transfer approval in grounded, Repomix and
`--no-ground-context` modes; disabling optional grounding does not discard
the normative contracts. The executor rechecks hashes before starting the
SDK and refuses stale or path-only context. Source drift is disclosed without
rewriting the approved requirements. Approved content is limited to 128 KiB;
exceeding the limit fails explicitly rather than truncating a contract.
The specification itself grants no permission to make a change.

## Commands

```text
mcpee specs discover
mcpee specs list [--all] [--json]
mcpee specs drift [--json]
mcpee specs ratify --slug <id> --reviewer <name> --confirm-sha256 <digest>
```

Run `mcpee sync` before discovery when source files have changed. A project
without Git is supported: drift detection uses the recorded and current file
hashes, not commit history.

The directory layout is format-neutral Markdown plus a JSON evidence manifest;
it does not claim conformance with Spec Kit or OpenSpec schemas. A future
adapter can map reviewed specifications to either format without changing the
separation between evidence, human approval, and normative requirements.
