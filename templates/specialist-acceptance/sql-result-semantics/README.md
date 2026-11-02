# Native SQL result semantics

Copy this directory into separate disposable baseline and candidate directories.
Run `python -B checks.py` with Python >=3.11 and its standard SQLite module.
No database service, network or credentials are used.

Repair only `eligible.sql`, `totals.sql` and `page.sql`. The initial queries are
intentionally incorrect; unchanged checks must fail before the repair.

- Eligible customers exclude blocked IDs, including nullable/duplicate block
  rows and empty sets, without duplicating customers.
- Totals retain every customer and sum each paid order exactly once. Pending
  orders contribute nothing and missing paid orders yield zero.
- Pages use descending `(score, id)` keyset order with the supplied named
  parameters. The cursor is exclusive; inserts ahead of it do not shift the
  remaining page. Zero limit returns no rows.

Seven checks execute the actual queries against isolated in-memory SQLite
databases with enforced foreign keys. They do **not** validate SQL Server
syntax/plans, performance thresholds, concurrent database transactions,
migration/restore safety or the broader SQL Server specialist scenario.
