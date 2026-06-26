# LocalStack MSK — provisioned cluster (aws_msk_cluster) for local development.
# LocalStack MSK emulation uses CreateCluster API (provisioned), not Serverless.
# Production uses aws_msk_serverless_cluster (see infra/terraform/modules/msk/).
#
# Requires: module.network (vpc_id, private_subnet_ids)

resource "aws_security_group" "msk_local" {
  name        = "${var.project_name}-${var.environment}-msk-local"
  description = "Allow Kafka PLAINTEXT from anywhere (LocalStack dev only)"
  vpc_id      = module.network.vpc_id

  ingress {
    from_port   = 9092
    to_port     = 9092
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Kafka PLAINTEXT for local development"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-${var.environment}-msk-local-sg" }
}

resource "aws_msk_cluster" "local" {
  cluster_name           = "${var.project_name}-${var.environment}-kafka"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = 1

  broker_node_group_info {
    instance_type   = "kafka.m5.xlarge"
    client_subnets  = module.network.private_subnet_ids
    security_groups = [aws_security_group.msk_local.id]
  }

  tags = { Name = "${var.project_name}-${var.environment}-msk" }
}
