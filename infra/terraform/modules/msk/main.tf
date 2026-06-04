resource "aws_security_group" "msk" {
  name        = "${var.project_name}-${var.environment}-msk"
  description = "Allow Kafka IAM auth only from ECS tasks"
  vpc_id      = var.vpc_id

  # MSK Serverless uses port 9098 for SASL/IAM
  ingress {
    from_port       = 9098
    to_port         = 9098
    protocol        = "tcp"
    security_groups = [var.ecs_task_sg_id]
    description     = "Kafka SASL/IAM from ECS tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-${var.environment}-msk-sg" }
}

# MSK Serverless — no broker count/instance type management.
# IAM auth only: authorization-service must assume an IAM role with kafka-cluster:* permissions.
resource "aws_msk_serverless_cluster" "main" {
  cluster_name = "${var.project_name}-${var.environment}-kafka"

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.msk.id]
  }

  client_authentication {
    sasl {
      iam { enabled = true }
    }
  }

  tags = { Name = "${var.project_name}-${var.environment}-msk" }
}
