variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "services" {
  type        = list(string)
  description = "Service names for which to create ECR repositories"
}
