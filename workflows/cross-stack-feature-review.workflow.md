# Cross-stack feature review

**Trigger:** A feature crosses UI, API/service, data, event, or external-service
boundaries, or changes behavior with multiple consumers.

**Lead roles:** Team lead; relevant senior frontend/backend/data engineers.

## Stages
1. Map acceptance criteria to user journeys, producers, consumers, services,
   contracts, permissions, and stored state.
2. Trace the request/event and response/failure path end to end; mark inferred
   links and missing evidence.
3. Review compatibility, validation, authorization, errors, retries/idempotency,
   loading/empty/permission states, and data migration implications.
4. Confirm vertical slices and ownership across roles; identify sequence and
   compatibility constraints.
5. Validate contract and integration scenarios, including representative failure
   and negative cases; report untested consumers.

## Outputs
Journey-to-contract map, affected consumer inventory, prioritized evidence-backed
findings, required tests, compatibility assessment, and unresolved decisions.
Creating tracker items or changing external systems is not implied.
