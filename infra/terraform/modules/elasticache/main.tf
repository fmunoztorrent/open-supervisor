resource "aws_security_group" "elasticache" {
  name        = "${var.project_name}-${var.environment}-elasticache"
  description = "Allow Redis only from ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.ecs_task_sg_id]
    description     = "Redis from ECS tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-${var.environment}-elasticache-sg" }
}

# ElastiCache Serverless — no cluster/shard management.
# sse-server uses Redis pub/sub; authorization-service publishes events.
resource "aws_elasticache_serverless_cache" "main" {
  engine = "redis"
  name   = "${var.project_name}-${var.environment}-redis"

  cache_usage_limits {
    data_storage {
      maximum = var.max_data_storage_gb
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = var.max_ecpu_per_second
    }
  }

  subnet_ids         = var.private_subnet_ids
  security_group_ids = [aws_security_group.elasticache.id]

  tags = { Name = "${var.project_name}-${var.environment}-redis" }
}
