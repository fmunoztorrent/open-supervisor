# Remote state configuration for the dev environment.
# Create these resources manually before running terraform init:
#
#   aws s3api create-bucket --bucket open-supervisor-terraform-state \
#     --region us-east-1 --create-bucket-configuration LocationConstraint=us-east-1
#   aws s3api put-bucket-versioning --bucket open-supervisor-terraform-state \
#     --versioning-configuration Status=Enabled
#   aws dynamodb create-table --table-name open-supervisor-terraform-locks \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH \
#     --billing-mode PAY_PER_REQUEST \
#     --region us-east-1
#
# Then uncomment the backend "s3" {} block in main.tf and run:
#   terraform init -backend-config=envs/dev/backend.hcl

bucket         = "open-supervisor-terraform-state"
key            = "open-supervisor/dev/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "open-supervisor-terraform-locks"
encrypt        = true
