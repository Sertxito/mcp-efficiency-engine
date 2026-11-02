resource "terraform_data" "entry" {
  count = length(var.entries)
  input = {
    name        = var.entries[count.index].name
    value       = var.entries[count.index].value
    environment = var.environment
  }
}

output "ids" {
  value = { for entry in terraform_data.entry : entry.output.name => entry.id }
}

output "values" {
  value = { for entry in terraform_data.entry : entry.output.name => entry.output.value }
}

output "environments" {
  value = { for entry in terraform_data.entry : entry.output.name => entry.output.environment }
}
