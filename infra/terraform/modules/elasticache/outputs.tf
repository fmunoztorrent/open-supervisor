output "primary_endpoint" {
  description = "Redis primary endpoint address (use for writes and pub/sub)"
  value       = aws_elasticache_serverless_cache.main.endpoint[0].address
}

output "reader_endpoint" {
  description = "Redis reader endpoint address"
  value       = aws_elasticache_serverless_cache.main.reader_endpoint[0].address
}

output "port" {
  value = aws_elasticache_serverless_cache.main.endpoint[0].port
}
