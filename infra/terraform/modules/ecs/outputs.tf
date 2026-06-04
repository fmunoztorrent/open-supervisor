output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.main.arn
}

output "service_discovery_namespace" {
  description = "Cloud Map private DNS namespace (e.g. open-supervisor-dev.local)"
  value       = aws_service_discovery_private_dns_namespace.main.name
}

output "task_execution_role_arn" {
  value = aws_iam_role.task_execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}
