variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "acm_certificate_arn" {
  type        = string
  description = "ARN of the ACM certificate for the HTTPS listener (must be in the same region)"
}
