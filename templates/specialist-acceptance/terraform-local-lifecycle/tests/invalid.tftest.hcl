run "environment" {
  command = plan
  variables {
    environment = "production"
  }
  expect_failures = [var.environment]
}

run "duplicate_names" {
  command = plan
  variables {
    entries = [
      { name = "alpha", value = "one" },
      { name = "alpha", value = "two" }
    ]
  }
  expect_failures = [var.entries]
}

run "empty_name" {
  command = plan
  variables {
    entries = [{ name = "", value = "one" }]
  }
  expect_failures = [var.entries]
}
