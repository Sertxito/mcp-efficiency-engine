# Relational tenant endpoint fixture

Copy this directory to a disposable project. The pinned .NET 10 application
uses ASP.NET Core and the actual EF Core SQLite relational provider, not an
in-memory EF substitute. Restore the declared dependencies locally, then run:

```powershell
dotnet build Checks\Checks.csproj
dotnet run --project Checks\Checks.csproj --no-build
```

The seeded query is deliberately wrong. Preserve its failing output, keep
the checks unchanged and give the specialist the exact exported scenario task.
Only application files are candidate implementation, not this check program.
The HTTP authentication header is an explicit synthetic fixture boundary,
not a production authentication recommendation.

The oracle exercises real startup/DI, HTTP validation and DTOs, tenant isolation,
server-side ordered/bounded SQL with parameters, cancellation, untracked reads,
empty pages and a committed write between reads. It does not prove SQL Server
behavior, consistent pagination across mutable snapshots, cancellation after a
database command is already in flight, or protection from arbitrary concurrent
writer schedules. Extend those checks before claiming those stronger outcomes.

Use separate executions, responses and review per normal/failure/boundary trial.
The failure variant additionally needs a controlled overlapping-write schedule;
the boundary variant must seed and exercise the singleton capture and incompatible
API proposal. The base fixture alone does not satisfy those additional variants.
