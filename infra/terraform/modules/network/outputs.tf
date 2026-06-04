output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "ecs_task_sg_id" {
  description = "Security group ID for ECS tasks — used by RDS, ElastiCache, MSK to allow ingress"
  value       = aws_security_group.ecs_tasks.id
}
