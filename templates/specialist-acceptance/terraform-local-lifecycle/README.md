# Native Terraform local lifecycle

Requires Node.js >=24 and **Terraform 1.14.0** on `PATH`. Copy this fixture into
separate disposable baseline and candidate directories. Run:

```powershell
node run-oracle.cjs
```

Repair **only `main.tf`**. Preserve all contract, runner and test files.
The initial module intentionally uses positional resource identities: reordering
the list associates a customer's logical name with a different native resource ID.
Use stable names while preserving values, environments and in-place updates.

The runner executes real Terraform `init`, `validate` and nine native test runs:

- resource outputs and environment propagation;
- empty input and cleanup;
- stable identities across list reordering;
- updates without unnecessary replacement;
- rejected environments, duplicate names and empty names.

Only the built-in `terraform_data` provider is used. Native test `apply` creates
local Terraform state objects, not cloud infrastructure; Terraform destroys them
when each test file finishes. Initialization disables backends, module downloads
and external provider discovery using an empty plugin directory. Data files live
in a unique temporary directory; inherited `TF_*` options/variables are removed.
The CLI configuration disables update checks.

The baseline must exit 1 with `MCPEE_ORACLE_FAILURE` after completing all nine
runs with a real test assertion failure. A repaired candidate exits 0 with
`MCPEE_ORACLE_RESULT` listing all nine checks. Missing/wrong Terraform versions,
invalid HCL, provider/setup errors, skipped tests, incomplete output and cleanup
errors must not produce either behavioral acceptance marker.

No provider download, credentials, cloud account, remote backend or deployment
is needed. This is **not** cloud provider/API, remote locking, migration/restore,
production drift or deployment acceptance. It does not certify all Terraform
versions or broad specialist behavior. Inspect/export the bounded contract with:

```powershell
mcpee evaluate --suite technology-runtime --scenario terraform-local-lifecycle --variant baseline --json
mcpee evaluate --suite technology-runtime --scenario terraform-local-lifecycle --variant candidate --json
```

The repository regression uses disposable copies, a test-only repaired control,
four semantic mutations, invalid HCL and real retained MCPEE evaluations. An
absent or different Terraform version is an explicit unrun skip, not a pass.
