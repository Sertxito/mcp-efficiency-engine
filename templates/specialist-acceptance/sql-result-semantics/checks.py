"""Real SQLite result checks, not SQL Server or query-performance certification."""

import json
from pathlib import Path
import sqlite3
import unittest


class Checks(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript("""
            PRAGMA foreign_keys = ON;
            CREATE TABLE customers (id INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, score INTEGER NOT NULL);
            CREATE TABLE blocked_customers (customer_id INTEGER REFERENCES customers(id));
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                amount INTEGER NOT NULL CHECK (amount >= 0),
                status TEXT NOT NULL CHECK (status IN ('paid', 'pending'))
            );
            INSERT INTO customers VALUES (2, 'two', 10), (4, 'four', 20), (1, 'one', 10), (3, 'three', 10);
            INSERT INTO orders VALUES (1, 1, 12, 'paid'), (2, 1, 12, 'paid'),
                (3, 1, 90, 'pending'), (4, 2, 20, 'pending'), (5, 3, 8, 'paid');
        """)

    def query(self, name, parameters=()):
        sql = Path(__file__).with_name(name + ".sql").read_text(encoding="utf-8")
        return self.db.execute(sql, parameters).fetchall()

    def test_antijoin_normal(self):
        self.db.execute("INSERT INTO blocked_customers VALUES (2)")
        self.assertEqual(self.query("eligible"), [(1,), (3,), (4,)])

    def test_antijoin_nullable_and_duplicate(self):
        self.db.executemany("INSERT INTO blocked_customers VALUES (?)", [(None,), (2,), (2,)])
        self.assertEqual(self.query("eligible"), [(1,), (3,), (4,)])

    def test_antijoin_empty_sets(self):
        self.assertEqual(self.query("eligible"), [(1,), (2,), (3,), (4,)])
        self.db.execute("DELETE FROM orders")
        self.db.execute("DELETE FROM customers")
        self.assertEqual(self.query("eligible"), [])

    def test_totals_preserve_empty_and_unpaid_customers(self):
        self.assertEqual(self.query("totals"), [(1, 24), (2, 0), (3, 8), (4, 0)])

    def test_totals_preserve_duplicate_amounts_and_integrity(self):
        self.db.execute("INSERT INTO orders VALUES (6, 1, 12, 'paid')")
        self.assertEqual(self.query("totals"), [(1, 36), (2, 0), (3, 8), (4, 0)])
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO orders VALUES (7, 999, 1, 'paid')")

    def test_page_stable_ties_and_boundaries(self):
        parameters = {"last_score": None, "last_id": None, "limit": 2}
        self.assertEqual(self.query("page", parameters), [(4, 20), (3, 10)])
        parameters.update(last_score=10, last_id=3)
        self.assertEqual(self.query("page", parameters), [(2, 10), (1, 10)])
        parameters.update(last_score=10, last_id=1)
        self.assertEqual(self.query("page", parameters), [])
        parameters.update(last_score=None, last_id=None, limit=0)
        self.assertEqual(self.query("page", parameters), [])

    def test_page_insert_does_not_shift_existing_cursor(self):
        first = self.query("page", {"last_score": None, "last_id": None, "limit": 2})
        self.db.execute("INSERT INTO customers VALUES (9, 'new', 30)")
        self.assertEqual(first, [(4, 20), (3, 10)])
        self.assertEqual(self.query("page", {
            "last_score": first[-1][1], "last_id": first[-1][0], "limit": 2,
        }), [(2, 10), (1, 10)])


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(Checks)
    )
    complete = result.testsRun == 7 and not result.skipped
    if complete:
        passed = result.wasSuccessful()
        payload = {
            "schema_version": 1,
            "id": "sql-result-semantics",
            "status": "passed" if passed else "failed",
        }
        if passed:
            payload["checks"] = unittest.defaultTestLoader.getTestCaseNames(Checks)
        else:
            payload.update(tests_run=result.testsRun, failures=len(result.failures), errors=len(result.errors))
        print(("MCPEE_ORACLE_RESULT " if passed else "MCPEE_ORACLE_FAILURE ") + json.dumps(payload))
    raise SystemExit(0 if complete and result.wasSuccessful() else 1)
