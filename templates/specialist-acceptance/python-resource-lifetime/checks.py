"""Native asyncio/resource oracle. No network, credentials or dependencies."""

import asyncio
import json
import unittest

from worker import process_files


class Resource:
    def __init__(self, value):
        self.value = value
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def read(self):
        if self.closed:
            raise RuntimeError("read after close")
        return self.value

    async def close(self):
        self.closed = True


class Checks(unittest.IsolatedAsyncioTestCase):
    async def test_order_and_capacity(self):
        active = 0
        maximum = 0
        resources = []

        async def open_file(value, *, encoding):
            self.assertEqual(encoding, "utf-8")
            resource = Resource(value)
            resources.append(resource)
            return resource

        async def consume(value):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            for _ in range(value + 1):
                await asyncio.sleep(0)
            active -= 1
            return value * 10

        self.assertEqual(
            await process_files([3, 0, 2, 1], 2, consume, open_file),
            [30, 0, 20, 10],
        )
        self.assertEqual(maximum, 2, "fill, but do not exceed, capacity")
        self.assertEqual(active, 0)
        self.assertTrue(all(resource.closed for resource in resources))

    async def test_unicode_and_empty(self):
        resources = []

        async def open_file(value, *, encoding):
            self.assertEqual(encoding, "utf-8")
            resource = Resource(value)
            resources.append(resource)
            return resource

        async def consume(value):
            return value

        self.assertEqual(
            await process_files(["\u00f1", "", "\U0001f600"], 2, consume, open_file),
            ["\u00f1", "", "\U0001f600"],
        )
        self.assertTrue(all(resource.closed for resource in resources))
        resources.clear()
        self.assertEqual(await process_files([], 2, consume, open_file), [])
        self.assertEqual(resources, [])

    async def test_invalid_limit_does_not_open(self):
        async def forbidden(*args, **kwargs):
            self.fail("invalid inputs must not open resources")

        for limit in [True, False, 0, -1, 1.5, "2", None]:
            with self.subTest(limit=limit):
                with self.assertRaises((ValueError, TypeError)):
                    await process_files(["file"], limit, forbidden, forbidden)

    async def test_worker_failure_is_preserved_and_closed(self):
        opened = []
        failure = ValueError("malformed fixture input")

        async def open_file(value, *, encoding):
            resource = Resource(value)
            opened.append(resource)
            return resource

        async def consume(value):
            raise failure

        with self.assertRaises(ValueError) as caught:
            await process_files(["bad", "must-not-open"], 1, consume, open_file)
        self.assertIs(caught.exception, failure)
        self.assertEqual(len(opened), 1)
        self.assertTrue(opened[0].closed)

    async def test_open_failure_is_not_partial_success(self):
        failure = OSError("fixture open failed")

        async def open_file(value, *, encoding):
            raise failure

        async def consume(value):
            self.fail("a failed open cannot produce a value")

        with self.assertRaises(OSError) as caught:
            await process_files(["missing"], 1, consume, open_file)
        self.assertIs(caught.exception, failure)

    async def test_cancellation_closes_resources_and_joins_workers(self):
        resources = []
        started = asyncio.Event()
        active = set()

        async def open_file(value, *, encoding):
            resource = Resource(value)
            resources.append(resource)
            return resource

        async def consume(value):
            task = asyncio.current_task()
            active.add(task)
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                active.remove(task)

        task = asyncio.create_task(process_files(["a", "b", "c"], 2, consume, open_file))
        try:
            await asyncio.wait_for(started.wait(), timeout=1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertTrue(all(resource.closed for resource in resources))
            self.assertEqual(active, set(), "no detached worker may survive cancellation")
            self.assertLessEqual(len(resources), 2)
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    async def test_failure_joins_siblings(self):
        resources = []
        active = set()
        both_started = asyncio.Event()
        failure = ValueError("parallel fixture failure")

        async def open_file(value, *, encoding):
            resource = Resource(value)
            resources.append(resource)
            return resource

        async def consume(value):
            task = asyncio.current_task()
            active.add(task)
            if len(active) == 2:
                both_started.set()
            try:
                await asyncio.wait_for(both_started.wait(), timeout=1)
                if value == "bad":
                    raise failure
                await asyncio.Event().wait()
            finally:
                active.remove(task)

        with self.assertRaises(ValueError) as caught:
            await asyncio.wait_for(
                process_files(["bad", "pending", "must-not-open"], 2, consume, open_file),
                timeout=2,
            )
        self.assertIs(caught.exception, failure)
        self.assertEqual(active, set())
        self.assertTrue(all(resource.closed for resource in resources))
        self.assertEqual(len(resources), 2)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Checks)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    complete = result.testsRun == 7 and not result.skipped
    if result.wasSuccessful() and complete:
        print("MCPEE_ORACLE_RESULT " + json.dumps({
            "schema_version": 1,
            "id": "python-resource-lifetime",
            "status": "passed",
            "checks": unittest.defaultTestLoader.getTestCaseNames(Checks),
        }, sort_keys=True))
    elif complete:
        print("MCPEE_ORACLE_FAILURE " + json.dumps({
            "schema_version": 1,
            "id": "python-resource-lifetime",
            "status": "failed",
            "tests_run": result.testsRun,
            "failures": len(result.failures),
            "errors": len(result.errors),
        }, sort_keys=True))
    raise SystemExit(0 if complete and result.wasSuccessful() else 1)
