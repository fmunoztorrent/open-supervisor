terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region     = var.aws_region
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    ec2   = var.localstack_endpoint
    ecr   = var.localstack_endpoint
    iam   = var.localstack_endpoint
    sts   = var.localstack_endpoint
    s3    = var.localstack_endpoint
    kafka = var.localstack_endpoint
  }

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform/LocalStack"
    }
  }
}

module "network" {
  source = "../modules/network"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

module "ecr" {
  source = "../modules/ecr"

  project_name = var.project_name
  environment  = var.environment
  services     = ["bff", "sse-server", "authorization-service"]
}
