# Deliver data pipeline

1. Bound sources, schemas, owners, consumers, privacy and quality objectives.
2. Trace transformations, lineage, deduplication keys, ordering, checkpoints and
   replay behavior; distinguish at-least-once delivery from idempotent effects.
3. Plan bounded changes or audit findings and representative synthetic checks.
4. Review only when asked to audit. Implement approved slices without exposing
   production data or assuming a replay is safe.
5. Verify quality, late/duplicate/invalid records, partial failure, replay and
   recovery; report exact results and unavailable runtime evidence.
6. Document contracts, findings, lineage and unverified scope. Observe quality
   signals and propose learning; require approval before persistence.

No production backfill, data export, schema mutation or cloud action is implied.
