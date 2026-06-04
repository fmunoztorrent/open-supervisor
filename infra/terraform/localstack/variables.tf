variable "aws_region" {
  description = "AWS region (LocalStack ignores this but must be valid)"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name — used as prefix for all resource names"
  type        = string
  default     = "open-supervisor"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "localstack"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AZs to deploy across"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "localstack_endpoint" {
  description = "LocalStack endpoint URL"
  type        = string
  default     = "http://localhost:4566"
}
