terraform {
  required_version = "= 1.14.0"
}

variable "environment" {
  type    = string
  default = "test"

  validation {
    condition     = contains(["test", "staging"], var.environment)
    error_message = "Only local test or staging environments are allowed."
  }
}

variable "entries" {
  type = list(object({
    name  = string
    value = string
  }))
  default = []

  validation {
    condition     = length(distinct([for entry in var.entries : entry.name])) == length(var.entries)
    error_message = "Entry names must be unique."
  }

  validation {
    condition     = alltrue([for entry in var.entries : can(regex("^[a-z][a-z0-9-]{0,31}$", entry.name))])
    error_message = "Entry names must be stable nonempty lowercase identifiers."
  }
}
