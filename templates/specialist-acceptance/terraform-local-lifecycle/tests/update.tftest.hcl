run "seed" {
  command = apply
  variables {
    entries = [{ name = "alpha", value = "one" }]
  }
}

run "update" {
  command = apply
  variables {
    entries = [{ name = "alpha", value = "two" }]
  }
  assert {
    condition     = output.ids["alpha"] == run.seed.ids["alpha"] && output.values["alpha"] == "two"
    error_message = "Changing a value must update in place without hiding drift or replacing identity."
  }
}
