# Moltbot on ECS

Deploys Moltbot to ECS with Bedrock authentication.

## Prerequisites

- AWS credentials configured
- Site-to-site VPN to home network

## Deploy

```bash
npm install

# Deploy to ap-southeast-4 (Melbourne)
AWS_DEFAULT_REGION=ap-southeast-4 npx cdk deploy

# Or with custom VPC/cluster names:
npx cdk deploy -c vpc_name=my-vpc -c cluster_name=my-cluster
```

## Initial Setup

After deployment, exec into the container to run onboarding:

```bash
# Get task ARN
TASK=$(aws ecs list-tasks --cluster moltbot-cluster --query 'taskArns[0]' --output text --region ap-southeast-4)

# Exec into container
aws ecs execute-command --cluster moltbot-cluster --task $TASK --container clawdbot --interactive --command "/bin/bash" --region ap-southeast-4

# Inside container: run onboarding
moltbot onboard
# Select: Amazon Bedrock → SDK credentials (auto-detected from task role)
```

## Architecture

- **VPC**: custom-vpc (has site-to-site VPN to home network)
- **ECS Cluster**: moltbot-cluster
- **EFS**: Persistent storage for `~/.moltbot` config and sessions
- **IAM**: Task role with Bedrock invoke permissions (CRIS global endpoints)
- **Network**: awsvpc mode, RFC1918 access to gateway port 18789

## VPC Endpoints

The ECS task runs in private subnets without public IPs. The following VPC endpoints are required:

| Endpoint | Purpose |
|----------|---------|
| ssm, ssmmessages, ec2messages | ECS Exec (container shell access) |
| ecr.api, ecr.dkr | Pull container images from ECR |
| s3 (gateway) | ECR image layers, general S3 access |
| logs | CloudWatch Logs |
| sts | IAM credential retrieval |
| bedrock-runtime | Bedrock model invocation |

**Important:** Interface endpoints must be present in the same AZ as the ECS task subnet.

## Accessing Gateway

From your home network (via VPN), connect to the ECS task's private IP on port 18789.

To find the task IP:

```bash
aws ecs describe-tasks --cluster moltbot-cluster --tasks $TASK --query 'tasks[0].attachments[0].details[?name==`privateIPv4Address`].value' --output text --region ap-southeast-4
```

## Docker Image Build

The Docker image is built from source using CodeBuild (ARM64). The build process:

1. Clones the moltbot repository
2. Installs pnpm and dependencies (`pnpm install`)
3. Builds the TypeScript (`pnpm build`)
4. Installs globally (`npm install -g .`)

This is required because the npm package needs the built `dist/` folder which isn't in the git repo.

## Model Configuration

The task role has permissions for:

- `bedrock:InvokeModel` / `bedrock:InvokeModelWithResponseStream` on all foundation models
- `bedrock:ListFoundationModels` / `bedrock:GetFoundationModel` for auto-discovery

Default model (set during onboard): `amazon-bedrock/global.anthropic.claude-opus-4-5-20251101-v1:0` (CRIS)
