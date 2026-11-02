# Python resource lifetime oracle

Copy this fixture to a disposable project and run `python checks.py` with Python
3.11 or newer. No packages, network or live systems are required.

The supplied worker is intentionally defective. Repair only `worker.py`; preserve
the independent checker. The async API is
`process_files(paths, limit, consume, open_file)`. `open_file(path,
encoding="utf-8")` returns an owned asynchronous context manager with `read()`;
`consume` is an asynchronous callback. Results must preserve input order.
The concurrency limit is a positive integer (not a boolean). Invalid limits must
fail before opening files. Failures must preserve their cause, stop admitting
work, close owned resources, cancel and join active siblings; cancellation must
propagate rather than return partial success.

The seven native unittest cases exercise real asyncio scheduling, task
cancellation and resource ownership with deterministic in-process I/O doubles,
Unicode/empty inputs and failure injection. A structured success marker is emitted
only after all seven tests pass without skips. This is not a filesystem integration,
wheel-installation, type-checking or multi-interpreter certification, nor a
complete oracle for the broader Python specialist scenario.
