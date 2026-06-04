output "db_endpoint" {
  description = "RDS instance hostname (without port)"
  value       = aws_db_instance.main.address
}

output "db_port" {
  value = aws_db_instance.main.port
}

output "db_name" {
  value = aws_db_instance.main.db_name
}

output "db_instance_id" {
  value = aws_db_instance.main.identifier
}
