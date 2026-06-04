# open-supervisor — Terraform

Infrastructure as Code for deploying open-supervisor on AWS using ECS Fargate.

## Architecture

```
Internet
  └── ALB (HTTPS, idle_timeout=3600)
        ├── /* (default)  → bff          (port 3000) — REST + SSE proxy for mobile app
        ├── /sse/*        → sse-server   (port 3001) — Redis pub/sub → SSE emitter
        └── /internal/*   → authorization-service (port 3002) — Kafka consumer/publisher

Private subnets (no public IPs):
  ├── ECS Fargate tasks (bff, sse-server, authorization-service)
  ├── RDS PostgreSQL 16 (Single-AZ dev / Multi-AZ prod)
  ├── ElastiCache Serverless Redis (pub/sub channel: store:{id}:requests)
  └── MSK Serverless Kafka (topics: auth.requests, auth.response.{store_id})

Cloud Map (DNS): service.open-supervisor-{env}.local
```

## Prerequisites

- Terraform >= 1.6
- AWS CLI v2 configured (`aws configure --profile <profile>`)
- An AWS account with sufficient IAM permissions
- A validated ACM certificate in the same region

## Directory structure

```
infra/terraform/
├── main.tf            # Root: providers, backend config, module wiring
├── variables.tf       # All input variables with defaults
├── outputs.tf         # Useful post-apply outputs
├── modules/
│   ├── network/       # VPC, subnets, IGW, NAT GWs, base SGs
│   ├── ecr/           # ECR repos + lifecycle policies
│   ├── alb/           # ALB, listeners, target groups, listener rules
│   ├── ecs/           # Cluster, task defs, services, IAM, Cloud Map, autoscaling
│   ├── rds/           # PostgreSQL 16, subnet group, parameter group
│   ├── elasticache/   # ElastiCache Serverless Redis
│   └── msk/           # MSK Serverless Kafka (IAM auth)
└── envs/
    ├── dev/           # terraform.tfvars + backend.hcl
    └── prod/          # terraform.tfvars + backend.hcl
```

## Step-by-step deployment

### 1. Pre-apply manual steps (do these ONCE, before any terraform command)

**a) Create the remote state bucket and DynamoDB lock table:**

```bash
aws s3api create-bucket \
  --bucket open-supervisor-terraform-state \
  --region us-east-1 \
  --create-bucket-configuration LocationConstraint=us-east-1

aws s3api put-bucket-versioning \
  --bucket open-supervisor-terraform-state \
  --versioning-configuration Status=Enabled

aws dynamodb create-table \
  --table-name open-supervisor-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Then uncomment the `backend "s3" {}` block in `main.tf`.

**b) Store the DB password in SSM Parameter Store:**

```bash
# Dev
aws ssm put-parameter \
  --name "/open-supervisor/dev/db/password" \
  --value "CHOOSE_A_STRONG_PASSWORD" \
  --type SecureString \
  --region us-east-1

# Prod
aws ssm put-parameter \
  --name "/open-supervisor/prod/db/password" \
  --value "CHOOSE_A_STRONG_PASSWORD" \
  --type SecureString \
  --region us-east-1
```

**c) Request and validate an ACM certificate:**

```bash
aws acm request-certificate \
  --domain-name api.yourdomain.com \
  --validation-method DNS \
  --region us-east-1
```

Complete DNS validation in your DNS provider (or Route53). Update `acm_certificate_arn` in `envs/{env}/terraform.tfvars` once the certificate status is `ISSUED`.

### 2. Initialize Terraform

```bash
cd infra/terraform

# Local state (no backend.hcl required — backend "s3" {} must remain commented out)
terraform init

# Remote state (after step 1a and uncommenting backend in main.tf)
terraform init -backend-config=envs/dev/backend.hcl
```

### 3. Plan and apply (Phase 1 — all infra except ECS image dependency)

```bash
terraform plan -var-file=envs/dev/terraform.tfvars -out=plan.tfplan
terraform apply plan.tfplan
```

Key outputs after Phase 1:

```bash
terraform output ecr_repository_urls   # URLs to push Docker images
terraform output msk_cluster_arn       # Needed for step 4
terraform output alb_dns_name          # Create your CNAME/alias here
```

### 4. Post-apply: retrieve MSK bootstrap brokers

MSK Serverless does not expose bootstrap broker strings as Terraform attributes.
After Phase 1 apply, retrieve them manually:

```bash
MSK_ARN=$(terraform output -raw msk_cluster_arn)
aws kafka get-bootstrap-brokers --cluster-arn "$MSK_ARN" --region us-east-1
```

Update `kafka_bootstrap_brokers` in `envs/dev/terraform.tfvars` with the returned string, then re-apply:

```bash
terraform apply -var-file=envs/dev/terraform.tfvars
```

### 5. Push Docker images to ECR (required before ECS services become healthy)

```bash
# Authenticate
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  $(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com

# Build and push (repeat for each service)
ECR_BFF=$(terraform output -json ecr_repository_urls | jq -r '.bff')
ECR_SSE=$(terraform output -json ecr_repository_urls | jq -r '."sse-server"')
ECR_AUTH=$(terraform output -json ecr_repository_urls | jq -r '."authorization-service"')

docker build -t "$ECR_BFF:latest" ../../apps/bff
docker push "$ECR_BFF:latest"

docker build -t "$ECR_SSE:latest" ../../apps/sse-server
docker push "$ECR_SSE:latest"

docker build -t "$ECR_AUTH:latest" ../../apps/authorization-service
docker push "$ECR_AUTH:latest"
```

After pushing images, force a new ECS deployment:

```bash
CLUSTER=$(terraform output -raw ecs_cluster_name)
aws ecs update-service --cluster "$CLUSTER" --service open-supervisor-dev-bff --force-new-deployment
aws ecs update-service --cluster "$CLUSTER" --service open-supervisor-dev-sse-server --force-new-deployment
aws ecs update-service --cluster "$CLUSTER" --service open-supervisor-dev-authorization-service --force-new-deployment
```

### 6. Point your domain to the ALB

Create a CNAME or Route53 alias record pointing to `terraform output alb_dns_name`.

---

## Deploying prod

```bash
terraform init -backend-config=envs/prod/backend.hcl -reconfigure
terraform plan  -var-file=envs/prod/terraform.tfvars -out=prod.tfplan
terraform apply prod.tfplan
```

---

## Design decisions

| Decision | Default | Rationale |
|---|---|---|
| RDS Single-AZ in dev | `rds_multi_az = false` | Cost savings in dev; set `true` for prod |
| NAT Gateway per AZ | Always | Prevents cross-AZ traffic charges and single-AZ failure |
| MSK Serverless | — | No broker sizing/patching; IAM auth only (no passwords) |
| ElastiCache Serverless | — | No cluster topology management; scales automatically |
| ALB `idle_timeout = 3600` | Always | SSE connections from the mobile app are long-lived |
| `deregistration_delay = 300` on SSE TG | Always | Drains SSE connections gracefully during deployments |
| `ignore_changes = [task_definition]` | Always | CI/CD owns image versions; Terraform owns infrastructure |
| DB password via SSM SecureString | Always | Never stored in `.tfvars` or state file in plaintext |
| Cloud Map private DNS | Always | Service-to-service calls use internal DNS without extra hops |
| Fargate only | Always | No EC2 node management; scales to zero |
| Container Insights enabled | Always | Required for ECS CPU-based autoscaling metrics |

## What's NOT automated (manual or out-of-scope)

- **ACM certificate DNS validation** — must be completed in your DNS provider before first apply
- **MSK bootstrap broker retrieval** — not available as a Terraform output for serverless clusters (see step 4)
- **Route53 hosted zone / DNS record** — create a CNAME or alias to `alb_dns_name` manually
- **VPC endpoints** — traffic from Fargate to ECR/CloudWatch goes through NAT GW; add `aws_vpc_endpoint` resources for `ecr.api`, `ecr.dkr`, `s3`, `logs` to reduce NAT costs in prod
- **Kafka topic creation** — topics `auth.requests` and `auth.response.*` are created by the application on startup (KafkaJS `{ allowAutoTopicCreation: true }`) or must be pre-created via the AWS console/CLI
- **Active Directory integration** — external AD is not managed here; configure the connection string in the application's environment variables
- **Secrets rotation** — SSM parameter rotation is not configured; implement AWS Secrets Manager rotation policies for prod
