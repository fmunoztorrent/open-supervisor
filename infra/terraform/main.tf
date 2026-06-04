terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # Descomenta para usar estado remoto compartido.
  # Crea el bucket S3 y la tabla DynamoDB MANUALMENTE antes del primer terraform init.
  # Luego inicializa con: terraform init -backend-config=envs/dev/backend.hcl
  #
  # backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ── Data sources ─────────────────────────────────────────────────────────────
data "aws_caller_identity" "current" {}

# ── Modules ───────────────────────────────────────────────────────────────────
module "network" {
  source = "./modules/network"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

module "ecr" {
  source = "./modules/ecr"

  project_name = var.project_name
  environment  = var.environment
  services     = ["bff", "sse-server", "authorization-service"]
}

module "alb" {
  source = "./modules/alb"

  project_name        = var.project_name
  environment         = var.environment
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = module.network.public_subnet_ids
  acm_certificate_arn = var.acm_certificate_arn
}

module "rds" {
  source = "./modules/rds"

  project_name         = var.project_name
  environment          = var.environment
  vpc_id               = module.network.vpc_id
  private_subnet_ids   = module.network.private_subnet_ids
  ecs_task_sg_id       = module.network.ecs_task_sg_id
  db_name              = var.db_name
  db_username          = var.db_username
  db_password_ssm_path = var.db_password_ssm_path
  instance_class       = var.rds_instance_class
  multi_az             = var.rds_multi_az
}

module "elasticache" {
  source = "./modules/elasticache"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  ecs_task_sg_id     = module.network.ecs_task_sg_id
}

module "msk" {
  source = "./modules/msk"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  ecs_task_sg_id     = module.network.ecs_task_sg_id
}

module "ecs" {
  source = "./modules/ecs"

  project_name       = var.project_name
  environment        = var.environment
  aws_region         = var.aws_region
  account_id         = data.aws_caller_identity.current.account_id
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  ecs_task_sg_id     = module.network.ecs_task_sg_id
  alb_sg_id          = module.alb.alb_sg_id

  ecr_repository_urls = module.ecr.repository_urls

  bff_target_group_arn  = module.alb.bff_target_group_arn
  sse_target_group_arn  = module.alb.sse_target_group_arn
  auth_target_group_arn = module.alb.auth_target_group_arn

  redis_primary_endpoint  = module.elasticache.primary_endpoint
  kafka_bootstrap_brokers = var.kafka_bootstrap_brokers
  db_host                 = module.rds.db_endpoint
  db_name                 = var.db_name
  db_username             = var.db_username
  db_password_ssm_path    = var.db_password_ssm_path

  bff_cpu            = var.bff_cpu
  bff_memory         = var.bff_memory
  bff_desired_count  = var.bff_desired_count
  sse_cpu            = var.sse_cpu
  sse_memory         = var.sse_memory
  sse_desired_count  = var.sse_desired_count
  auth_cpu           = var.auth_cpu
  auth_memory        = var.auth_memory
  auth_desired_count = var.auth_desired_count
}
