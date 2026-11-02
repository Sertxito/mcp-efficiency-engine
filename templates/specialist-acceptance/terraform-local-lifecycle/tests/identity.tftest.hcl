run "seed" {
  command = apply
  variables {
    entries = [
      { name = "alpha", value = "one" },
      { name = "beta", value = "two" }
    ]
  }
}

run "reorder" {
  command = apply
  variables {
    entries = [
      { name = "beta", value = "two" },
      { name = "alpha", value = "one" }
    ]
  }
  assert {
    condition     = output.ids["alpha"] == run.seed.ids["alpha"] && output.ids["beta"] == run.seed.ids["beta"]
    error_message = "Reordering inputs must preserve each named resource identity."
  }
}
