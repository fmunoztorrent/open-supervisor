variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "account_id" {
  type        = string
  description = "AWS account ID — used to construct SSM parameter ARNs for ECS secrets block"
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "ecs_task_sg_id" {
  type        = string
  description = "Shared security group ID for ECS tasks (created in network module)"
}

variable "alb_sg_id" {
  type        = string
  description = "ALB security group ID — used to add an ingress rule allowing ALB → tasks"
}

variable "ecr_repository_urls" {
  type        = map(string)
  description = "Map of service name → ECR repository URL (keys: bff, sse-server, authorization-service)"
}

variable "bff_target_group_arn" {
  type = string
}

variable "sse_target_group_arn" {
  type = string
}

variable "auth_target_group_arn" {
  type = string
}

variable "redis_primary_endpoint" {
  type        = string
  description = "ElastiCache Serverless Redis primary endpoint hostname"
}

variable "kafka_bootstrap_brokers" {
  type        = string
  description = <<-EOT
    MSK Serverless bootstrap broker string (port 9098, SASL/IAM).
    Not exposed by Terraform for serverless clusters — populate after first apply.
  EOT
  sensitive   = true
}

variable "db_host" {
  type = string
}

variable "db_name" {
  type = string
}

variable "db_username" {
  type = string
}

variable "db_password_ssm_path" {
  type        = string
  description = "SSM Parameter Store path for DB password — injected as ECS secret (not env var)"
  sensitive   = true
}

# ── Fargate sizing ────────────────────────────────────────────────────────────
variable "bff_cpu" {
  type = number
}

variable "bff_memory" {
  type = number
}

variable "bff_desired_count" {
  type = number
}

variable "sse_cpu" {
  type = number
}

variable "sse_memory" {
  type = number
}

variable "sse_desired_count" {
  type = number
}

variable "auth_cpu" {
  type = number
}

variable "auth_memory" {
  type = number
}

variable "auth_desired_count" {
  type = number
}
