"""Deliberately defective fixture; repair only a disposable copy."""

import asyncio


async def process_files(paths, limit, consume, open_file):
    results = []

    async def process(path):
        resource = await open_file(path, encoding="utf-8")
        results.append(await consume(await resource.read()))

    await asyncio.gather(*(process(path) for path in paths))
    return results
