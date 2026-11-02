# Specification workspace and evidence discovery

## Start here: one product workspace

Open `docs/README.md` in an initialized project, then `docs/specifications/README.md`. They link current features,
their review status and next action, source documents, automatic project maps
and historical material. You should not need to navigate internal JSON or
snapshot directories to find your functional specifications.
If that entry already has owner edits, it is preserved and navigation is
written to the adjacent `MCPEE.md`; the CLI prints the actual entry-point path.

All user-facing documentation lives in `docs/`. Functional deliverables live in
`docs/specifications/<state>/<feature>/`, where state is `proposed`, `reviewed`
or `approved`: `spec.md`, independent
`<case-slug>.md` files, `decisions.md` (readable) and `decisions.json` (owner-decision
records), `specification.json` (validated structured input), `manifest.json`
(source/case provenance) and `lifecycle.json` (machine validation and reviews).
Technical `plan.md`/`plan.json` and checkable `tasks.md`/`tasks.json` are authored
in the same directory, not parallel document trees. The JSON and Markdown are
one source-bound artifact pair, not independent contracts. Owner edits are
preserved and disagreements block advancement rather than being overwritten.

### Names and navigation

The same layout and naming apply whether sources are documents (greenfield)
or an existing application (brownfield). Use short, stable capability names,
not descriptions: for example `docs/specifications/proposed/about-us/about-us-staff.md`
and the adjacent `about-us-ambassador.md`. Prefer 2-4 lowercase kebab-case words;
new explicit feature and case names allow at most 64 characters and 8 words.
Do not include origin prefixes, `part-1`, snapshot hashes, or `UC-001` in public
names. Reserved workspace/Windows filenames and name collisions are rejected,
not silently fixed with numbers or hashes.

The author supplies each use case's `slug`; `UC-###` remains its stable internal
reference for coverage, dependencies and verification. Older responses without
case slugs derive bounded descriptive filenames from titles. Existing canonical
`UC-###.md` files and approvals remain readable and are not renamed silently.
`docs/specifications/README.md` lists atomic specifications directly, with links,
capability, state, authority and implementation verification; feature overviews,
plans and decisions are linked separately.
An empty index explicitly says that no functional specs have been authored.
Automatic inventories live in `docs/generated/specification-evidence/`. They are
extraction evidence, never atomic product specs or automatic sources of truth.

The whole feature bundle moves physically between state directories without
changing feature/case names. `mcpee specs review --slug <feature> --reviewer <owner>
--confirm-sha256 <digest>` records review without approval. Explicit specification
approval, or implementation with current passing recorded checks, promotes the
bundle to `approved/` and establishes authority. Reviewed is not approved.
Stale implementation evidence removes verification-derived authority; an explicit
approved specification remains normative despite application-source drift.

`mcpee specs status [--slug <feature>]` reports the next phase and exact review
digests. New runtime-authored features use `advancement: validated`: specification,
plan and task checks advance phases automatically without a separate approval
prompt. Machine validation is labeled separately from human review. Resolve
source contradictions and open specification decisions with `specs decide`.
High-impact technical decisions and open phase questions block the plan/tasks
handoff visibly (`clarify-phase`); reconcile the documented decision or explicitly
review its exact digest. Manual and migrated drafts retain their explicit review
policy; `specs approve` remains available for those and optional human review.
Planning/execution requests routed to a canonical feature recheck the required
approval before creating an SDK session. With multiple canonical features,
name the feature. Ordinary review/status commands do not call a model.
For an automatically validated feature, request "Create plan for `<feature>`",
then "Create tasks for `<feature>`" through the task tool. `plan create` is a
manual template helper, not a substitute for structured technical authoring;
it refuses to insert an empty planning template into an automatic workspace.

Reviews bind the actual case documents and decisions, not only an index link.
Editing upstream artifacts invalidates downstream approvals. Source drift
blocks new approval/execution but does not erase the normative approved contract.
Ready-for-implementation never means implemented, tested or accepted by users;
run actual project checks and review their evidence separately.

Run `mcpee specs migrate` for older projects. Legacy root `specs/` bundles move
into the appropriate document state with rebased links, preserved review history
and audited before/after hashes. Machine-only validation becomes reviewed, not
approved. Manual drafts remain unvalidated. Legacy ratified contracts and
internal extraction inventories move under `docs/` without inventing approval.
Older pre-workspace drafts already under `docs/specifications/` are imported
without transferring approval and their originals remain for provenance.
Conflicting content and edited cases are never silently overwritten.

This adopts staged specification-driven work, not Spec Kit installation,
command compatibility or automatic execution of all its stages. The authoring
run still stops at the requested phase. Machine validation is not proof of
semantic correctness, successful implementation or product acceptance.

## One canonical graph and retrieval corpus

`docs/specifications/<state>/<feature>/` is the workspace for both paths. A shared canonical
artifact inventory includes the specification, atomic cases, manifest,
decisions and available plans/tasks. Sync includes these artifacts even when
`knowledge.sourceRoots` only covers application directories. The source
manifest supplies the same source ID, path, SHA-256 and canonical authority to
the unified graph, lexical index and embedding chunks. Draft and approved
specification authority are distinct; indexing a draft does not approve it. Runtime authoring
refreshes the unified graph and lexical index after publication; it does not
claim that embeddings were generated. Existing local embeddings are refreshed
by the normal embedding command and stale chunks are not treated as fresh.

Canonical artifacts, review snapshots, lifecycle state and historical discovery
trees are not reingested as original product evidence in the next specification
extraction. Original code and documentation retain their provenance; a
canonical requirement does not rewrite conflicting observed behavior.

## Static evidence discovery

MCPEE creates reviewable proposals by candidate domain from an existing
project's indexed sources. Discovery is deterministic and local: it records
source paths, SHA-256 hashes, extracted headings and symbols, supported C#
validation/route/authorization declarations, and declared test names. It
does not execute tests, infer business intent, send source content to a model,
or declare observed code to be desired behavior.

## Complete brownfield

`mcpee init` on an existing application, `mcpee brownfield`, or a whole-project
request such as "Run brownfield" completes local source conversion/retrieval,
code/document graph synchronization and Copilot functional proposal authoring.
MarkItDown converts supported binary inputs; local lexical retrieval remains
available without embeddings. Related original documents are selected alongside
code, not replaced by generated inventories. Every original document also has
its own primary coverage units; bounded contextual omissions are recorded.
Only primary ranges require section coverage in a unit. Related documentation
is interpretation/contradiction context, not a requirement to specify an entire
transversal document for every code domain. All cited context still requires
an exact quote in its selected range and unchanged original/normalized hashes.

Requesting complete brownfield authorizes the Copilot source transfer and quota
use without an additional authoring confirmation. Tool installations and risky
actions retain their existing approvals. `init --prepare-only` is the explicit
local-only alternative; it does not claim complete brownfield.

Every successfully authored scope produces descriptive, source-bound atomic
files in `docs/specifications/proposed/`. Machine validation checks their
structure and provenance but does not mark them reviewed or approved in this
onboarding flow. Contradictions and missing intent remain open questions.
The batch persists progress under `.mcpee/reports/brownfield/`; a failed scope
records its error, SDK session and saved candidate directory, then independent
scopes continue. Successful scopes keep their proposals. A later request reuses current verified artifacts and
continues missing scopes; it never silently overwrites edits or spends quota
again for already current scopes. A project lock prevents duplicate batches.
Final source-bound reconciliation is required before reporting completion.
Large projects can take hours; the CLI warns before authoring and reports
counts, elapsed time and last observed phase activity every 30 seconds. A
heartbeat proves the batch is alive, not that the model made useful progress.
The default `--concurrency auto` chooses one read-only model session per ten
pending extraction units, rounded up and capped at ten. Reusable proposals and
blocked units do not increase that count; more than 100 pending units uses ten
sessions, and a fully reusable batch starts none. `--concurrency 1..10` overrides
the automatic choice to bound quota usage. This is a startup choice, not
continuous autoscaling; provider limits may prevent proportional speedups.
Publication and indexing run synchronously in the owning
process, not competing file-writing workers. Naming conflicts preserve both
the original artifacts and failed candidate evidence, never overwrite a spec.
The planner reads the lexical index once per preparation rather than once per
unit. Within a batch, routing and execution reuse prepared scopes while the
inventory, source/normalized-file metadata and lexical index remain unchanged.
Changes invalidate preparation, and selected source hashes are still checked
before execution/publication. No preparation cache persists across batches.
All domains use the same queue by default. Only for explicit owner priorities,
use `mcpee brownfield --concurrency 4 --last-domain reporting` to process other
domains first; deferred domains start only after all other workers have drained.
There is no automatic retry loop. Per-session deadlines and bounded repairs
remain enforced. An extraction/validation failure, timeout or source conversion
failure cannot stop eligible independent scopes. Host cancellation, broken
shared infrastructure or inability to persist evidence still stops safely.
Any failed scope, blocked source or incomplete reconciliation produces a
`partial` report and nonzero exit, never complete or approved status.
Original-document retrieval is filtered before ranking so newly generated
proposals cannot displace the input documents or change remaining scope tasks.
Host cancellation stops the batch and preserves completed proposals. Recovery
of a saved onboarding candidate retains its complete scope and proposed state;
it does not automatically advance it to reviewed or approved.
For proposals, a wrong evidence line can be mechanically reconciled only when
the unchanged exact quote occurs at one unique line in the selected source.
The original response and hash remain in execution evidence; the manifest
records the old/new coordinates and quote hash. Missing or ambiguous quotes
still fail validation, with all invalid citations reported together.
Unsupported covered sections report their exact inclusive line range:
evidence elsewhere in the file is insufficient. Technical-only imports or
scaffolding may be explicitly out-of-scope with a reason, never silently
treated as covered business behavior.
For an interrupted SDK session, `mcpee brownfield --resume-session <uuid>`
resumes only its exact unchanged scope, using its saved conversation and
diagnostic; later scopes continue normally. Already published scopes cannot be
resumed as paid work. Bounded repair attempts continue receiving new diagnostics.
Graph refresh timestamps are excluded from resume identity, but source hashes,
task, model, route and all other context remain bound. Older sessions require
their hash-verified original prompt evidence for this compatibility check.
Exact authoring scopes use their selected code and document sources, not
unrelated globally ranked graph hits. This keeps generated proposals and graph
refreshes from changing a scope's model context. Graphs remain available for
reconciliation and implementation. An older interrupted session with genuinely
different context is rejected; start a fresh scope execution rather than
silently rebasing its saved conversation.
This is extraction/authoring completeness, not semantic or product certification.

## Functional authoring versus static inventory

### Large brownfield preparation

`mcpee init` runs this preparation after its initial sync for brownfield
projects. Run `mcpee specs scopes --json` any time after sync to regenerate and
inspect the exact bounded authoring tasks without a model call or source write.
The planner reuses the existing inferred
path-domain grouping and accounts for every source in the inventory as planned,
blocked or explicitly excluded. It includes code, tests, documents and config,
not only the first retrieved sources. Stale source hashes and invalid paths fail
explicitly. Processing failures remain visible; logs, generated harness artifacts
and prior canonical specifications are listed as excluded, not silently lost.

Each exported task names all selected sources and an internal source-bound scope
ID. The author chooses descriptive feature/case names for the shared
`docs/specifications/<state>/<feature>/<case-slug>.md` workspace, independent of that ID. Reconciliation
binds the scope through provenance and exact source hashes, not public filenames;
multiple matching specifications are reported as ambiguous, never picked silently.
Each extraction unit fits four primary files, 24 KiB of primary text and twelve
primary sections; related excerpts share a separate 12 KiB context budget.
Large sources are split into contiguous, nonoverlapping numbered line ranges.
The planner verifies that every line of every planned original source belongs
to exactly one primary unit. Unit boundaries are mechanical, not certified
business capabilities; cross-unit prerequisites remain questions for reconciliation.
Numbered verbatim excerpts, roles and mandatory section boundaries are supplied
before generation, avoiding a separate full-file discovery pass for each unit.

The router's 10000-character task limit and existing per-source safety checks
(2 MiB / 1000 sections) still apply. A source exceeding those checks, or a single
line exceeding the unit byte budget, remains explicitly blocked with a split
action; it is never truncated. Exit 2 signals blocked sources even when other
tasks are prepared.

Every successful unit is published and checkpointed independently through the
same authoring/validation/recovery engine. A later run retries only missing or
failed units. Unchanged, structurally valid legacy whole-domain proposals may
cover several new units without regeneration; their original sources and all
artifact hashes are checked first. Edited or ambiguous prior work blocks reuse,
not overwrites. Reconciliation counts a reused case file once even when it
covers multiple units, and preserves graph links to all applicable units.

Execute each exact exported task through normal `mcpee run`/`mcpee_run`; it still
rechecks the scope digest and exact task against the current inventory before
paid execution. Changing a source and synchronizing does not authorize reuse of
an old task: export current scopes again. It validates the canonical specification. These
are preparation scopes, not authored specifications or certified business
boundaries. After authoring, run `mcpee specs reconcile --json`. The command
checks the current scope and artifact hashes, builds a case/source matrix,
reports exact duplicate-goal and shared-evidence candidates, links source-level
contradiction candidates, and maps current graph imports/tests across scopes.
Its report is stored at `.mcpee/state/specification-reconciliation.json`.
Technical imports are not business prerequisites; textual matches are not
proof of duplicates or contradictions. The result always requires owner review
and never approves requirements or grants product acceptance. Missing scope
specifications, stale artifacts, or a stale graph remain explicitly incomplete
or blocked. This does not bypass approval for real decisions or authorize
implementation, and is separate from greenfield document authoring.

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
Markdown as an index under `docs/specifications/<state>/<descriptive-slug>/spec.md`, with
one self-contained `<case-slug>.md` file per
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
   otherwise include all eligible product code, tests, configuration,
   infrastructure, business, architecture, documentation, contract and
   decision sources. Code declarations and non-Markdown files require explicit
   source-section coverage too. Do not silently use the first five search
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
   semantic atomicity or completeness.
6. **Hand off transparently.** Present unresolved decisions and deferred
   sections. When no decisions remain, record automated validation and allow
   technical planning without a second approval. Do not create parallel legacy
   review proposals or start implementation during specification authoring.

These are authoring stages within one bounded model attempt, not a claim that
several independent specialist agents executed. The executor remains read-only;
MCPEE performs validated artifact persistence. A documentation-only authoring
request does not query or require an application CodeGraph index. Plain npm-init
metadata also does not by itself establish an application implementation.

## Legacy draft review handoff

Matching source-bound discovery proposals have their empty behavior and
acceptance prompts filled from the validated cases, without manual copying.
The executor returns their paths and current review digests. Existing reviewed
text is preserved. This compatibility handoff is for the manual publication
API, not the new autonomous runtime path. A case citing sources
outside a proposal is not copied into it: cross-domain approval needs a
deliberately reviewed evidence boundary, not an unbound requirement.

Missing sources fail before the SDK starts. Invalid output or sources changing
during execution fail the run rather than reporting template generation as a
completed specification. The executor saves each response and exact validation
diagnostic under `.mcpee/reports/authoring/<run>/`, then permits at most two
repairs in the same SDK session, within the original execution deadline.
It never repeats sync or starts a new session for a repair. Source drift,
publication conflicts and exhausted attempts fail explicitly; candidates remain
available instead of being lost between runs. Proposal-only sessions receive the
exact source contract and policy context, not implementation-only stack evidence,
technical guides or impact-graph inventories. Required section ranges are supplied
before generation: a covered section needs a mapped case with an exact quote
inside that section, not elsewhere in the file.

For a parseable proposal, repairs may return
`{"replacements":[{"path":"/coverage/0/status","value":"covered"}]}`
using JSON Pointer paths to existing fields or array indices. Replace the smallest
affected field; replacing an array can add or remove its elements. MCPEE applies
only the explicitly supplied replacements and runs the full schema, source,
coverage and dependency checks again. It does not infer a replacement or silently
downgrade coverage. Complete corrected JSON remains accepted; an initial malformed
candidate still needs complete JSON. Expanded candidates retain the normal recovery
path; original model repair responses and their hashes are saved separately in
the same execution evidence directory. Repairs retain the original deadline.
These structural and provenance checks cannot
prove semantic completeness, correctness, runtime behavior or owner approval.
Specification, plan and task prose share placeholder detection that preserves
ordinary Spanish words such as `todo` and `método` and explicit discussion of
unfinished source behavior. Literal evidence quotes may contain source comments
such as `TODO`; they must still match the unchanged source at the cited line.
Source sections marked deferred remain visible review gaps.
Recover a persisted response without another model run using
`mcpee specs recover --candidate .mcpee/reports/authoring/<run>/specification-3.txt`.
An optional `--source <original-path>` restricts recovery to a source already
present in the recorded snapshot. Recovery checks the response checksum,
source hashes and current canonical phase digests; changed evidence, missing
checksums or conflicting owner edits fail explicitly. Recovery publishes
validated artifacts and refreshes graph/lexical inventories, not an in-flight
SDK session or a vector embedding index.
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
`docs/generated/specification-evidence/` after the initial source sync when eligible sources
exist. Inventories remain nonauthoritative evidence until a reviewer ratifies
a completed behavior contract. Later source changes are reported as drift; neither
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
   in `docs/specifications/<state>/<feature>/`, not just the static inventory. Review the
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
`docs/generated/specification-evidence/reviews/<snapshot>/index.md`. Open that index rather than the JSON
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

## Legacy static-proposal ratification

This compatibility path preserves existing brownfield evidence approvals.
For new functional bundles, use `specs status` and `specs approve` in the
canonical workspace instead of duplicating owner review here.

1. Open the index printed by discovery and choose a domain/part.
   Run `mcpee specs list` to find its current SHA-256.
2. Review `docs/generated/specification-evidence/<id>.md` and the linked case catalog. Replace the
   behavior and acceptance-criteria prompts with owner-confirmed, testable
   statements; record unresolved questions and relevant check results.
3. Run `mcpee specs ratify --slug <id> --reviewer "<name>" --confirm-sha256 <digest>`.
   The digest must match the exact reviewed Markdown file. Ratification is
   rejected while the prompts remain or any referenced source has changed or
   disappeared since the indexed snapshot. The snapshot reference also binds
   the evidence/case records; editing generated case pages or removing source
   references from their manifest cannot bypass the review.
4. Approved specifications and their source-hash manifest are created
   exclusively under `docs/specifications/approved/<id>/`. Existing files are never
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
mcpee specs status [--slug <feature>] [--json]
mcpee specs migrate [--json]
mcpee specs decide --slug <feature> --id Q-001 --answer <decision> --reviewer <owner>
mcpee specs approve --slug <feature> --stage specification|plan|tasks --reviewer <owner> --confirm-sha256 <digest>
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
