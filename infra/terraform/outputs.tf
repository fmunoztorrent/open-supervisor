output "vpc_id" {
  description = "VPC ID"
  value       = module.network.vpc_id
}

output "alb_dns_name" {
  description = "ALB DNS name — point your domain's CNAME here (or use as Route53 alias target)"
  value       = module.alb.alb_dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID — needed for Route53 alias records"
  value       = module.alb.alb_zone_id
}

output "ecr_repository_urls" {
  description = "ECR repository URLs (push images here before deploying ECS services)"
  value       = module.ecr.repository_urls
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host only, no port)"
  value       = module.rds.db_endpoint
  sensitive   = true
}

output "elasticache_primary_endpoint" {
  description = "ElastiCache Serverless Redis primary endpoint"
  value       = module.elasticache.primary_endpoint
  sensitive   = true
}

output "msk_cluster_arn" {
  description = "MSK Serverless cluster ARN — use with 'aws kafka get-bootstrap-brokers' to retrieve broker string"
  value       = module.msk.cluster_arn
}

output "service_discovery_namespace" {
  description = "AWS Cloud Map private DNS namespace (internal service-to-service discovery)"
  value       = module.ecs.service_discovery_namespace
}
