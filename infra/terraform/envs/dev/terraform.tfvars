aws_region         = "us-east-1"
project_name       = "open-supervisor"
environment        = "dev"
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# Replace with the ARN of your ACM certificate (must be validated before apply)
acm_certificate_arn = "arn:aws:acm:us-east-1:REPLACE_ACCOUNT_ID:certificate/REPLACE_CERT_ID"

# ── RDS ───────────────────────────────────────────────────────────────────────
db_name              = "opensupervisor"
db_username          = "dbadmin"
db_password_ssm_path = "/open-supervisor/dev/db/password"
rds_instance_class   = "db.t3.micro"
rds_multi_az         = false

# ── MSK (populate after first apply) ─────────────────────────────────────────
# After `terraform apply`, run:
#   aws kafka get-bootstrap-brokers --cluster-arn $(terraform output -raw msk_cluster_arn)
# Then update this value and re-apply.
kafka_bootstrap_brokers = "PLACEHOLDER_UPDATE_AFTER_MSK_CREATION:9098"

# ── ECS — BFF ─────────────────────────────────────────────────────────────────
bff_cpu           = 512
bff_memory        = 1024
bff_desired_count = 1

# ── ECS — SSE Server ──────────────────────────────────────────────────────────
sse_cpu           = 256
sse_memory        = 512
sse_desired_count = 1

# ── ECS — Authorization Service ───────────────────────────────────────────────
auth_cpu           = 512
auth_memory        = 1024
auth_desired_count = 1
