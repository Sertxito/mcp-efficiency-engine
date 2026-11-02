run "nonempty" {
  command = apply
  variables {
    environment = "staging"
    entries = [
      { name = "alpha", value = "one" },
      { name = "beta", value = "two" }
    ]
  }
  assert {
    condition     = tomap(output.values) == tomap({ alpha = "one", beta = "two" })
    error_message = "Every named value must reach the native resource output."
  }
  assert {
    condition     = tomap(output.environments) == tomap({ alpha = "staging", beta = "staging" })
    error_message = "Environment input must reach every resource."
  }
}

run "empty" {
  command = apply
  variables {
    entries = []
  }
  assert {
    condition     = length(output.ids) == 0 && length(output.values) == 0 && length(output.environments) == 0
    error_message = "Empty input must remove every local resource without fabricated output."
  }
}
