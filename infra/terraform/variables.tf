variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name — used as prefix for all resource names and tags"
  type        = string
  default     = "open-supervisor"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be 'dev' or 'prod'."
  }
}

# ── Networking ────────────────────────────────────────────────────────────────
variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Exactly 2 AZs to deploy across (subnets, NAT GWs, RDS Multi-AZ)"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# ── TLS ────────────────────────────────────────────────────────────────────────
variable "acm_certificate_arn" {
  description = "ARN of a pre-validated ACM certificate for the ALB HTTPS listener"
  type        = string
}

# ── RDS PostgreSQL ────────────────────────────────────────────────────────────
variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "opensupervisor"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "dbadmin"
}

variable "db_password_ssm_path" {
  description = "SSM Parameter Store path containing the DB password (SecureString). Must exist before apply."
  type        = string
  default     = "/open-supervisor/dev/db/password"
  sensitive   = true
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ standby for RDS (strongly recommended for prod)"
  type        = bool
  default     = false
}

# ── Kafka (MSK Serverless) ────────────────────────────────────────────────────
variable "kafka_bootstrap_brokers" {
  description = <<-EOT
    MSK Serverless bootstrap broker string for the authorization-service.
    MSK Serverless does not expose this via Terraform outputs — populate after first apply:
      aws kafka get-bootstrap-brokers --cluster-arn <msk_cluster_arn>
    Then store in SSM and re-run apply with this variable set.
  EOT
  type        = string
  default     = "PLACEHOLDER_UPDATE_AFTER_MSK_CREATION:9098"
  sensitive   = true
}

# ── ECS Fargate — BFF ─────────────────────────────────────────────────────────
variable "bff_cpu" {
  description = "CPU units for BFF task (256/512/1024/2048/4096)"
  type        = number
  default     = 512
}

variable "bff_memory" {
  description = "Memory (MiB) for BFF task"
  type        = number
  default     = 1024
}

variable "bff_desired_count" {
  description = "Desired number of BFF task instances"
  type        = number
  default     = 1
}

# ── ECS Fargate — SSE Server ──────────────────────────────────────────────────
variable "sse_cpu" {
  description = "CPU units for SSE server task"
  type        = number
  default     = 256
}

variable "sse_memory" {
  description = "Memory (MiB) for SSE server task"
  type        = number
  default     = 512
}

variable "sse_desired_count" {
  description = "Desired number of SSE server task instances"
  type        = number
  default     = 1
}

# ── ECS Fargate — Authorization Service ──────────────────────────────────────
variable "auth_cpu" {
  description = "CPU units for authorization-service task"
  type        = number
  default     = 512
}

variable "auth_memory" {
  description = "Memory (MiB) for authorization-service task"
  type        = number
  default     = 1024
}

variable "auth_desired_count" {
  description = "Desired number of authorization-service task instances"
  type        = number
  default     = 1
}
