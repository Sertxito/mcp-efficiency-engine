# Relational tenant endpoint fixture

Copy this directory to a disposable project. The pinned .NET 10 application
uses ASP.NET Core and the actual EF Core SQLite relational provider, not an
in-memory EF substitute. From this directory, restore dependencies and run the
native oracle:

```powershell
dotnet run --project Checks\Checks.csproj
```

`node --test tests\dotnet-oracle.test.js` runs the full regression harness from
the repository root. It builds and executes the deliberately defective
baseline, a test-only reference implementation, and source mutations against
fresh disposable copies. The baseline must compile and fail an assertion; the
reference must emit the final `MCPEE_ORACLE_RESULT` JSON marker only after all
native assertions pass. The harness also requires mutations of tenant and
status filtering, ordering/page bounds, cancellation, singleton DI lifetime,
and response shape to be detected. In evaluations, only
`Api\OrderQuery.cs` is mutable candidate input. `global.json`, both project
files, `Api\Program.cs`, and `Checks\Program.cs` are immutable fixture and
oracle inputs; the reference implementation and all mutation controls exist
only in the repository test file. Never edit oracle inputs to make a candidate
pass.

The native assertions cover actual startup/DI scope validation, compatible
HTTP success/401/400/500 contracts, DTO shape, tenant authority and isolation,
parameterized server-side filtering/order/pagination, empty and maximum pages,
request cancellation, read-only tracking, a provider failure followed by
recovery, and a deterministically gated writer that commits before the held
read executes. The singleton-capture and response-envelope mutations are
boundary controls for detecting an incompatible lifetime/API proposal.

These checks do not prove SQL Server behavior, a consistent snapshot across
concurrent mutable pages, cancellation after a database command is already in
flight, or correctness for arbitrary concurrent writer schedules. The tenant
header is a synthetic fixture boundary, not a production authentication
recommendation. Do not claim a specialist/model execution based on this oracle.
