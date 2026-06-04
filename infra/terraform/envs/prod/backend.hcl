# Same S3 bucket as dev, different state key.
# See envs/dev/backend.hcl for bucket/table creation commands.

bucket         = "open-supervisor-terraform-state"
key            = "open-supervisor/prod/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "open-supervisor-terraform-locks"
encrypt        = true
