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
  type        = list(string)
  description = "Private subnet IDs — MSK Serverless requires at least one subnet per AZ used"
}

variable "ecs_task_sg_id" {
  type        = string
  description = "Security group ID of ECS tasks — granted ingress on port 9098"
}
