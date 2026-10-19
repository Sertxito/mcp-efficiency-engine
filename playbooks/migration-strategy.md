# Migration Strategy Playbook

Use this playbook when a system, workload, platform, or service must move or
change hosting while preserving required business behavior. Plan from evidence
about the current system; do not select a strategy from labels alone.

## Strategy selection

- **Lift and shift** only when infrastructure is the main issue and the
  existing runtime, dependencies, security posture, and operating model are
  supportable at the target. Record the technical debt and operational burden
  that move with it.
- **Replatform** when the runtime needs modernization but the domain model
  remains valid. Prefer managed services only when they remove material
  operational burden without forcing broad redesign.
- **Refactor** when evidenced architectural, reliability, security, scaling, or
  maintainability constraints cannot be resolved by moving or replatforming.
  Prefer incremental changes with measurable outcomes.
- **Strangler Fig** is preferred for a critical legacy system when it has
  identifiable boundaries and consumers can migrate gradually. Define routing,
  data ownership, and coexistence rules for every slice.
- **Rebuild** only when evidence shows the existing asset has negative net
  value and the replacement has a validated business case, migration path, and
  acceptable continuity risk.

Compare viable strategies against delivery and continuity risk, compatibility,
cost, capacity, skills, operability, reversibility, security, and lifecycle
support. Record rejected options and why; do not assume a provider, migration
tool, downtime allowance, consistency model, or target architecture.

## Required assessment

1. Establish current behavior, system boundaries, owners, dependencies,
   consumers, runtime and service versions, data stores, service levels, and
   operational baselines. Cite repository or system evidence; label assumptions,
   unknowns, and evidence gaps.
2. Record business outcomes, constraints, target state, compliance and security
   requirements, downtime limits, recovery objectives, and the accountable
   decision owner.
3. Identify capability and dependency boundaries. Map identity, networking,
   secrets and configuration, integrations, data flows, operational ownership,
   and observability dependencies.
4. Assess target compatibility, capacity, lifecycle support, skills, cost, and
   the changes needed for each viable strategy. Capture material trade-offs and
   unresolved decisions.
5. Define staged execution with owners, prerequisites, measurable acceptance
   criteria, decision gates, stop/abort conditions, and the evidence required
   to proceed at each stage.

## Required migration controls

- **Parallel or shadow validation:** define the comparison window, datasets,
  signals, tolerances, and owner. If parallel operation is unsafe or impractical,
  explain why and specify an alternative verification method.
- **Data migration validation and recovery:** validate counts, checksums or reconciliations,
  representative records, consistency, privacy, and recovery. Specify source of
  truth during coexistence, write ownership, retry/idempotency behavior, and
  reconciliation of divergence. Protect sensitive data and use approved,
  anonymized samples for tests.
- **Consumer compatibility:** cover versions and contracts, API or schema
  compatibility, dual-read/write behavior where applicable, consumer rollout,
  deprecation, and an explicit end to coexistence.
- **Cutover and recovery:** use staged routing, feature flags, or other reversible
  controls where feasible. Define rollback and forward-recovery separately,
  including tested triggers, owners, time bounds, data consequences, and
  limitations. Do not imply rollback reverses irreversible data changes or
  external side effects.
- **Observability:** establish a pre-cutover baseline and target signals,
  dashboards or queries, health checks, alert thresholds, and an owner watching
  each rollout stage. State how long signals must remain within tolerance.
- **Approvals:** require business sign-off per capability or cutover stage and
  explicit approval for each production or irreversible action. Planning is not
  authorization to execute.
- **Post-cutover and decommission:** verify behavior, data, consumers, and
  operational ownership against acceptance criteria. Keep the prior system
  available until recovery criteria are met; define decommissioning and record
  retention explicitly.

## Outputs

- Evidence-backed strategy decision with current-state findings, assumptions,
  alternatives, trade-offs, rejected options, and the decision owner.
- Dependency-aware migration stages and capability cutover sequence with owners,
  prerequisites, approvals, and measurable acceptance and abort criteria.
- Data, consumer compatibility, parallel validation, observability, rollback,
  forward-recovery, and decommission controls.
- Risks, unresolved questions, and named owners for decisions and operational
  actions.
- Exact checks and evidence observed, outcomes, and items not yet verified.

## Safety boundaries

- Planning does not authorize execution. Obtain approval for the exact target
  and state-changing action before running it.
- Do not claim migration readiness from a target architecture diagram alone;
  require current-state evidence, dependency coverage, and a validated recovery
  path.
- Do not silently assume a cloud provider, migration tool, availability target,
  data consistency model, acceptable downtime, or reversibility.
- Distinguish proposed controls from controls that were implemented and tested.
  A documented rollback plan is not evidence of a tested recovery.
