# Running OpenClaw in the Cloud: A Journey Through Names, Networks, and Sandboxed AI

*Published: [Date]*

**Disclaimer:** This is a personal project done in my own time. It is not affiliated with my employer in any way. Do not deploy this on corporate networks or use it for work purposes. This is experimental software that connects an AI agent to messaging platforms with significant autonomous capabilities - only use it if you fully understand the security implications.

Sometimes the best projects start with a simple question: "Should I run this on my computer?", which may lead to "What if I could run it in a nice, sandboxed cloud environment?". When -Clawdbot- OpenClaw launched, this question led me down a rabbit hole that resulted in [openclaw-ecs](https://github.com/jsamuel1/openclaw-ecs) - a CDK project that deploys OpenClaw to AWS ECS, so that I can be confident it won't be exfiltrating my trusted work or personal data.

## What is OpenClaw?

[OpenClaw](https://github.com/openclaw/openclaw) is a personal AI assistant you run on your own devices. Unlike cloud-hosted assistants, OpenClaw runs a local Gateway that connects to the channels you already use - WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Microsoft Teams, and more. It's the "own your data" approach to AI assistants, with 141k GitHub stars (and growing) and a passionate community of AI's behind it.

The Gateway is the control plane - it manages sessions, channels, tools, and events. OpenClaw's docs explicitly support running this Gateway on a remote Linux instance (they call it "Remote Gateway" mode). My ECS setup takes this pattern further with AWS-native security.

## A Word of Caution

OpenClaw is powerful - and that's exactly why you should be careful. Once connected to messaging channels like WhatsApp, Telegram, or Slack, it can:

- **Execute arbitrary code** on the host system via bash tools
- **Read and write files** anywhere the process has access
- **Send messages** on your behalf to anyone in your contacts
- **Browse the web** and interact with websites
- **Run scheduled tasks** via cron without supervision

This isn't a criticism of OpenClaw - these capabilities are features, not bugs. But an AI agent with filesystem access, network access, and the ability to impersonate you on messaging platforms deserves serious thought about where you run it.

Running it on your personal laptop means it has access to your SSH keys, browser cookies, password managers, and everything else. A prompt injection attack via an incoming message could potentially exfiltrate sensitive data.

## Why Run OpenClaw in ECS?

Running OpenClaw locally means dealing with API keys, storage limitations, and having an AI agent with filesystem access on your main machine. Running the Gateway in ECS provides **containment** - if something goes wrong, the blast radius is limited to an isolated container with no access to your personal data:

### 1. Security Through IAM

The ECS task role is beautifully restrictive. It only has permissions for:

- Bedrock model invocation (the AI brains)
- EFS access (for persistent storage)
- SSM for ECS Exec (so I can shell into the container)

No stored API keys, no secrets files, no credentials lying around. Everything comes from the AWS environment via the task role. It's security through infrastructure, and it feels good.

### 2. Simple Storage with EFS

One of my favorite aspects is the EFS mount. The container's `HOME` is set to `/data`, so OpenClaw's config at `~/.openclaw` persists across container restarts. The AI can create files, download dependencies, or generate massive codebases without me worrying about disk space. EFS just grows as needed.

### 3. Network Isolation

The whole setup runs in private subnets, only accessible via my VPN on port 18789 (OpenClaw's default Gateway port). It's like having a secure AI bunker that I can access from anywhere on my home network.

### 4. Container Benefits

When you want to update OpenClaw or blow everything away and start fresh, it's just a container redeploy. No more "works on my machine" - it either works in the container or it doesn't.

## The Technical Stack

The infrastructure is built with AWS CDK in TypeScript (because life's too short for CloudFormation YAML). Here's what's under the hood:

- **ECS on EC2**: Running on t4g.small ARM instances because they're cost-effective and OpenClaw doesn't need much compute
- **EFS**: Mounted at `/data` which is set as `HOME`, so `~/.openclaw` persists
- **Bedrock**: Connected via global endpoints for model access
- **Docker Image**: Using the community-maintained `alpine/openclaw` image from Docker Hub (ARM64 compatible)
- **VPC Endpoints**: A whole collection of them since the task runs in private subnets

The container runs with `--bind lan` to listen on all interfaces, and `--allow-unconfigured` to start even without a full config (the config is loaded from EFS). Environment variables point OpenClaw to the EFS-mounted config directory.

The VPC endpoint setup was particularly fun - you need endpoints for ECS control plane, ECR image pulling, CloudWatch logs, SSM for exec access, and of course Bedrock runtime. Miss one and you get cryptic networking errors.

## The Docker Image

Rather than building from source, I'm using the community-maintained [`alpine/openclaw`](https://hub.docker.com/r/alpine/openclaw) image from Docker Hub. It's kept up-to-date with OpenClaw releases and supports both AMD64 and ARM64 architectures - perfect for our cost-effective t4g instances.

## Getting Started

If you want to try this yourself:

```bash
git clone https://github.com/jsamuel1/openclaw-ecs
cd openclaw-ecs
npm install

# Deploy infrastructure (starts with 0 tasks - no cost until onboarded)
AWS_REGION=ap-southeast-4 npx cdk deploy -c vpc_name=custom-vpc -c cluster_name=openclaw-cluster
```

### First-Run Setup

The stack deploys with `desiredCount=0` because OpenClaw needs onboarding before it can run. I've included a setup script that handles the chicken-and-egg problem:

```bash
# Run the setup script
./scripts/setup.sh
```

The script:
1. Launches a temporary t4g.micro EC2 instance with EFS mounted
2. Connects you via SSM Session Manager
3. You run `openclaw onboard` and configure Bedrock
4. Terminate the instance and start the ECS service

Once connected to the setup instance:

```bash
sudo -i
export HOME=/data
export PATH=/usr/local/bin:$PATH  # Node 22 is installed here
npm install -g openclaw

# Create the Bedrock config (the onboard wizard doesn't support Bedrock directly)
mkdir -p /data/.openclaw
cat > /data/.openclaw/openclaw.json << 'EOF'
{"agents":{"defaults":{"model":{"primary":"bedrock/anthropic.claude-opus-4-5-20251101-v1:0"}}}}
EOF

# Verify config
cat /data/.openclaw/openclaw.json
exit
```

**Note:** OpenClaw requires Node.js 22+. The setup script installs Node 22 from the official binary distribution since Amazon Linux 2023's default nodejs package is v20.

**Note:** We create the config file manually because OpenClaw's `onboard` wizard doesn't have a Bedrock option - it expects Anthropic API keys or OAuth. The ECS task role provides Bedrock credentials automatically via the AWS SDK.

After setup, terminate the instance and start the service:

```bash
# Terminate setup instance (script shows the instance ID)
aws ec2 terminate-instances --instance-ids $INSTANCE_ID

# Deploy with desired_count=1 to start the service
npx cdk deploy -c desired_count=1 -c vpc_name=custom-vpc -c cluster_name=openclaw-cluster
```

### After Onboarding

Once the service is running, use ECS Exec for future access:

```bash
TASK=$(aws ecs list-tasks --cluster openclaw-cluster --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster openclaw-cluster --task $TASK --container openclaw --interactive --command "/bin/bash"
```

## What's Next?

This was a fun weekend project that scratched a particular itch - running AI assistants in a secure, isolated environment. The combination of ECS, EFS, and Bedrock creates a surprisingly robust platform for AI workloads.

I'm thinking about extending this pattern to other AI tools. Maybe a Jupyter notebook environment with similar security constraints, or a dedicated environment for running AI-generated code safely.

The repository is public at [github.com/jsamuel1/openclaw-ecs](https://github.com/jsamuel1/openclaw-ecs) if you want to poke around or suggest improvements.

---

*This post was drafted with assistance from Kiro, because using AI to write about AI infrastructure felt appropriately recursive.*
