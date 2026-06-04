aws_region         = "us-east-1"
project_name       = "open-supervisor"
environment        = "prod"
vpc_cidr           = "10.1.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# Replace with the ARN of your validated ACM certificate
acm_certificate_arn = "arn:aws:acm:us-east-1:REPLACE_ACCOUNT_ID:certificate/REPLACE_CERT_ID"

# ── RDS ───────────────────────────────────────────────────────────────────────
db_name              = "opensupervisor"
db_username          = "dbadmin"
db_password_ssm_path = "/open-supervisor/prod/db/password"
rds_instance_class   = "db.t3.medium"
rds_multi_az         = true

# ── MSK (populate after first apply) ─────────────────────────────────────────
kafka_bootstrap_brokers = "PLACEHOLDER_UPDATE_AFTER_MSK_CREATION:9098"

# ── ECS — BFF ─────────────────────────────────────────────────────────────────
bff_cpu           = 1024
bff_memory        = 2048
bff_desired_count = 2

# ── ECS — SSE Server ──────────────────────────────────────────────────────────
sse_cpu           = 512
sse_memory        = 1024
sse_desired_count = 2

# ── ECS — Authorization Service ───────────────────────────────────────────────
auth_cpu           = 1024
auth_memory        = 2048
auth_desired_count = 2
