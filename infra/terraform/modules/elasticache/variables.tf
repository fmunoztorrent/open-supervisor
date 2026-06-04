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
  description = "Security group ID of ECS tasks — granted ingress on port 6379"
}

variable "max_data_storage_gb" {
  type        = number
  default     = 10
  description = "Maximum data storage for ElastiCache Serverless in GB"
}

variable "max_ecpu_per_second" {
  type        = number
  default     = 1000
  description = "Maximum ECPUs per second for ElastiCache Serverless"
}
