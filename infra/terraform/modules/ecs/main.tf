# ── Cluster ───────────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${var.project_name}-${var.environment}-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ── CloudWatch Log Groups ─────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "service" {
  for_each = toset(["bff", "sse-server", "authorization-service"])

  name              = "/ecs/${var.project_name}-${var.environment}/${each.key}"
  retention_in_days = 30

  tags = { Name = "${var.project_name}-${var.environment}-${each.key}-logs" }
}

# ── IAM: Task Execution Role (ECR pull, CloudWatch Logs, SSM secrets) ─────────
resource "aws_iam_role" "task_execution" {
  name = "${var.project_name}-${var.environment}-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = { Name = "${var.project_name}-${var.environment}-task-execution-role" }
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow ECS agent to pull secrets from SSM Parameter Store
resource "aws_iam_role_policy" "task_execution_ssm" {
  name = "${var.project_name}-${var.environment}-ssm-secrets"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters", "secretsmanager:GetSecretValue", "kms:Decrypt"]
      Resource = "*"
    }]
  })
}

# ── IAM: Task Role (runtime — MSK IAM auth, future S3, etc.) ─────────────────
resource "aws_iam_role" "task" {
  name = "${var.project_name}-${var.environment}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = { Name = "${var.project_name}-${var.environment}-task-role" }
}

# MSK Serverless requires kafka-cluster:* IAM permissions on the task role
resource "aws_iam_role_policy" "task_msk" {
  name = "${var.project_name}-${var.environment}-msk"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "kafka-cluster:Connect",
        "kafka-cluster:AlterCluster",
        "kafka-cluster:DescribeCluster",
        "kafka-cluster:CreateTopic",
        "kafka-cluster:DeleteTopic",
        "kafka-cluster:DescribeTopic",
        "kafka-cluster:AlterTopic",
        "kafka-cluster:WriteData",
        "kafka-cluster:ReadData",
        "kafka-cluster:AlterGroup",
        "kafka-cluster:DescribeGroup",
      ]
      Resource = "*"
    }]
  })
}

# ── Security Group rule: allow ALB → ECS tasks ────────────────────────────────
resource "aws_security_group_rule" "ecs_from_alb" {
  type                     = "ingress"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "tcp"
  source_security_group_id = var.alb_sg_id
  security_group_id        = var.ecs_task_sg_id
  description              = "ALB → ECS tasks"
}

# ── AWS Cloud Map (internal service discovery) ────────────────────────────────
resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${var.project_name}-${var.environment}.local"
  description = "Internal DNS for ${var.project_name} ${var.environment} services"
  vpc         = var.vpc_id

  tags = { Name = "${var.project_name}-${var.environment}-dns-namespace" }
}

resource "aws_service_discovery_service" "bff" {
  name = "bff"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config { failure_threshold = 1 }
}

resource "aws_service_discovery_service" "sse" {
  name = "sse-server"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config { failure_threshold = 1 }
}

resource "aws_service_discovery_service" "auth" {
  name = "authorization-service"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config { failure_threshold = 1 }
}

# ── Local: shared env vars used across task definitions ───────────────────────
locals {
  node_env       = var.environment == "prod" ? "production" : "development"
  namespace_fqdn = "${var.project_name}-${var.environment}.local"

  # SSM ARN prefix for the secrets block in task definitions
  ssm_arn_prefix = "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter"
}

# ── BFF Task Definition ───────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "bff" {
  family                   = "${var.project_name}-${var.environment}-bff"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.bff_cpu
  memory                   = var.bff_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "bff"
    image     = "${var.ecr_repository_urls["bff"]}:latest"
    essential = true

    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = [
      { name = "PORT",             value = "3000" },
      { name = "NODE_ENV",         value = local.node_env },
      { name = "SSE_SERVER_URL",   value = "http://sse-server.${local.namespace_fqdn}:3001" },
      { name = "AUTH_SERVICE_URL", value = "http://authorization-service.${local.namespace_fqdn}:3002" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["bff"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = { Name = "${var.project_name}-${var.environment}-bff-td" }
}

resource "aws_ecs_service" "bff" {
  name                              = "${var.project_name}-${var.environment}-bff"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.bff.arn
  desired_count                     = var.bff_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_task_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.bff_target_group_arn
    container_name   = "bff"
    container_port   = 3000
  }

  service_registries {
    registry_arn = aws_service_discovery_service.bff.arn
  }

  # Ignore task_definition so CI/CD image updates don't cause Terraform drift
  lifecycle { ignore_changes = [task_definition, desired_count] }

  depends_on = [aws_iam_role_policy_attachment.task_execution_managed]
}

# ── SSE Server Task Definition ────────────────────────────────────────────────
resource "aws_ecs_task_definition" "sse" {
  family                   = "${var.project_name}-${var.environment}-sse-server"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.sse_cpu
  memory                   = var.sse_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "sse-server"
    image     = "${var.ecr_repository_urls["sse-server"]}:latest"
    essential = true

    portMappings = [{ containerPort = 3001, protocol = "tcp" }]

    environment = [
      { name = "PORT",       value = "3001" },
      { name = "NODE_ENV",   value = local.node_env },
      { name = "REDIS_HOST", value = var.redis_primary_endpoint },
      { name = "REDIS_PORT", value = "6379" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["sse-server"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = { Name = "${var.project_name}-${var.environment}-sse-td" }
}

resource "aws_ecs_service" "sse" {
  name                              = "${var.project_name}-${var.environment}-sse-server"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.sse.arn
  desired_count                     = var.sse_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_task_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.sse_target_group_arn
    container_name   = "sse-server"
    container_port   = 3001
  }

  service_registries {
    registry_arn = aws_service_discovery_service.sse.arn
  }

  lifecycle { ignore_changes = [task_definition, desired_count] }

  depends_on = [aws_iam_role_policy_attachment.task_execution_managed]
}

# ── Authorization Service Task Definition ─────────────────────────────────────
resource "aws_ecs_task_definition" "auth" {
  family                   = "${var.project_name}-${var.environment}-authorization-service"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.auth_cpu
  memory                   = var.auth_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "authorization-service"
    image     = "${var.ecr_repository_urls["authorization-service"]}:latest"
    essential = true

    portMappings = [{ containerPort = 3002, protocol = "tcp" }]

    environment = [
      { name = "PORT",          value = "3002" },
      { name = "NODE_ENV",      value = local.node_env },
      { name = "REDIS_HOST",    value = var.redis_primary_endpoint },
      { name = "REDIS_PORT",    value = "6379" },
      { name = "KAFKA_BROKERS", value = var.kafka_bootstrap_brokers },
      { name = "DB_HOST",       value = var.db_host },
      { name = "DB_PORT",       value = "5432" },
      { name = "DB_NAME",       value = var.db_name },
      { name = "DB_USERNAME",   value = var.db_username },
    ]

    secrets = [
      {
        name      = "DB_PASSWORD"
        valueFrom = "${local.ssm_arn_prefix}${var.db_password_ssm_path}"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["authorization-service"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = { Name = "${var.project_name}-${var.environment}-auth-td" }
}

resource "aws_ecs_service" "auth" {
  name                              = "${var.project_name}-${var.environment}-authorization-service"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.auth.arn
  desired_count                     = var.auth_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_task_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.auth_target_group_arn
    container_name   = "authorization-service"
    container_port   = 3002
  }

  service_registries {
    registry_arn = aws_service_discovery_service.auth.arn
  }

  lifecycle { ignore_changes = [task_definition, desired_count] }

  depends_on = [aws_iam_role_policy_attachment.task_execution_managed]
}

# ── Auto Scaling — BFF ────────────────────────────────────────────────────────
resource "aws_appautoscaling_target" "bff" {
  max_capacity       = 6
  min_capacity       = var.bff_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.bff.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "bff_cpu" {
  name               = "${var.project_name}-${var.environment}-bff-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.bff.resource_id
  scalable_dimension = aws_appautoscaling_target.bff.scalable_dimension
  service_namespace  = aws_appautoscaling_target.bff.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ── Auto Scaling — Authorization Service ─────────────────────────────────────
resource "aws_appautoscaling_target" "auth" {
  max_capacity       = 6
  min_capacity       = var.auth_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.auth.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "auth_cpu" {
  name               = "${var.project_name}-${var.environment}-auth-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.auth.resource_id
  scalable_dimension = aws_appautoscaling_target.auth.scalable_dimension
  service_namespace  = aws_appautoscaling_target.auth.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
