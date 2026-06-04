output "repository_urls" {
  description = "Map of service name → ECR repository URL"
  value       = { for k, v in aws_ecr_repository.service : k => v.repository_url }
}

output "repository_arns" {
  value = { for k, v in aws_ecr_repository.service : k => v.arn }
}
