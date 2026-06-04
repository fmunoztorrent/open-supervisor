variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "ecs_task_sg_id" {
  type        = string
  description = "Security group ID of ECS tasks — granted ingress on port 5432"
}

variable "db_name" {
  type = string
}

variable "db_username" {
  type = string
}

variable "db_password_ssm_path" {
  type        = string
  description = "SSM Parameter Store path for the DB password (must be a SecureString)"
  sensitive   = true
}

variable "instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "allocated_storage" {
  type        = number
  default     = 20
  description = "Initial storage in GiB — auto-scales up to 5x this value"
}

variable "multi_az" {
  type        = bool
  default     = false
  description = "Enable Multi-AZ standby. Set true for prod."
}
