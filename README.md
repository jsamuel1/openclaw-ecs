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
TASK=$(aws ecs list-tasks --cluster clawdbot-cluster --query 'taskArns[0]' --output text --region ap-southeast-4)

# Exec into container
aws ecs execute-command --cluster clawdbot-cluster --task $TASK --container clawdbot --interactive --command "/bin/bash" --region ap-southeast-4

# Inside container: run onboarding
moltbot onboard
# Select: Amazon Bedrock → SDK credentials (auto-detected from task role)
```

## Architecture

- **VPC**: clawdbot-vpc (has site-to-site VPN to home network)
- **ECS Cluster**: clawdbot-cluster
- **EFS**: Persistent storage for `~/.moltbot` config and sessions
- **IAM**: Task role with Bedrock invoke permissions (CRIS global endpoints)
- **Network**: awsvpc mode, RFC1918 access to gateway port 18789

## Accessing Gateway

From your home network (via VPN), connect to the ECS task's private IP on port 18789.

To find the task IP:

```bash
aws ecs describe-tasks --cluster clawdbot-cluster --tasks $TASK --query 'tasks[0].attachments[0].details[?name==`privateIPv4Address`].value' --output text --region ap-southeast-4
```

## Model Configuration

The task role has permissions for:

- `bedrock:InvokeModel` / `bedrock:InvokeModelWithResponseStream` on all foundation models
- `bedrock:ListFoundationModels` / `bedrock:GetFoundationModel` for auto-discovery

Default model (set during onboard): `amazon-bedrock/global.anthropic.claude-opus-4-5-20251101-v1:0` (CRIS)
