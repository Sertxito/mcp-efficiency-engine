param(
  [string]$RegistryPath = "repo-registry/repos.yml",
  [switch]$Strict
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$args = @(".\scripts\validate-repo-registry.py", "--registry", $RegistryPath)
if ($Strict) {
  $args += "--strict"
}

python @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
