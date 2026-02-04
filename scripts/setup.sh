#!/bin/bash
# First-run setup script for OpenClaw on ECS
# Launches a temporary EC2 instance with EFS mounted to run onboarding

set -e

STACK_NAME="${STACK_NAME:-OpenclawEcsStack}"
REGION="${AWS_REGION:-ap-southeast-4}"

echo "=== OpenClaw First-Run Setup ==="
echo "Stack: $STACK_NAME"
echo "Region: $REGION"
echo

# Get stack outputs
echo "Fetching stack outputs..."
EFS_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`EfsFileSystemId`].OutputValue' --output text)
SG_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`SecurityGroupId`].OutputValue' --output text)

if [ -z "$EFS_ID" ] || [ "$EFS_ID" = "None" ]; then
  echo "ERROR: Could not find EFS filesystem. Is the stack deployed?"
  exit 1
fi

echo "EFS ID: $EFS_ID"
echo "Security Group: $SG_ID"

# Get a private subnet from the VPC
VPC_ID=$(aws ec2 describe-security-groups --group-ids "$SG_ID" --region "$REGION" \
  --query 'SecurityGroups[0].VpcId' --output text)

SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*private*" \
  --query 'Subnets[0].SubnetId' --output text --region "$REGION")

if [ -z "$SUBNET_ID" ] || [ "$SUBNET_ID" = "None" ]; then
  # Fallback to any subnet in the VPC
  SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[0].SubnetId' --output text --region "$REGION")
fi

echo "Subnet: $SUBNET_ID"
echo

# Create IAM instance profile if needed
PROFILE_NAME="OpenclawSetupProfile"
if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" &>/dev/null; then
  echo "Creating IAM instance profile..."
  
  # Create role
  aws iam create-role --role-name "$PROFILE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "ec2.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' --no-cli-pager
  
  # Attach policies
  aws iam attach-role-policy --role-name "$PROFILE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam attach-role-policy --role-name "$PROFILE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonElasticFileSystemClientReadWriteAccess
  aws iam attach-role-policy --role-name "$PROFILE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess
  
  # Create instance profile
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" --no-cli-pager
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$PROFILE_NAME"
  
  echo "Waiting for instance profile to propagate..."
  sleep 10
fi

# Launch EC2 instance
echo "Launching setup instance..."
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --instance-type t4g.micro \
  --subnet-id "$SUBNET_ID" \
  --security-group-ids "$SG_ID" \
  --iam-instance-profile Name="$PROFILE_NAME" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=openclaw-setup}]" \
  --user-data "#!/bin/bash
yum install -y amazon-efs-utils git
# Install Node 22 from binary (NodeSource doesn't work well on AL2023)
cd /usr/local
curl -fsSL https://nodejs.org/dist/v22.13.1/node-v22.13.1-linux-arm64.tar.xz | tar -xJ
ln -sf /usr/local/node-v22.13.1-linux-arm64/bin/node /usr/local/bin/node
ln -sf /usr/local/node-v22.13.1-linux-arm64/bin/npm /usr/local/bin/npm
ln -sf /usr/local/node-v22.13.1-linux-arm64/bin/npx /usr/local/bin/npx
mkdir -p /data
mount -t efs -o tls,iam ${EFS_ID}:/ /data
chown 1000:1000 /data
" \
  --query 'Instances[0].InstanceId' --output text --region "$REGION")

echo "Instance ID: $INSTANCE_ID"
echo

# Wait for instance to be ready
echo "Waiting for instance to be ready (this takes ~2 minutes)..."
aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID" --region "$REGION"
echo "Instance ready!"
echo

# Instructions
cat << EOF
=== Connect and Run Onboarding ===

1. Connect to the instance:
   aws ssm start-session --target $INSTANCE_ID --region $REGION

2. Once connected, run:
   sudo -i
   export HOME=/data
   export PATH=/usr/local/bin:\$PATH
   export OPENCLAW_IMAGE=alpine/openclaw
   npm install -g openclaw
   openclaw onboard
   
   Select: Amazon Bedrock → SDK credentials
   Choose your preferred model (e.g., anthropic/claude-sonnet-4-5)

3. Exit the session (type 'exit' twice)

4. Terminate the setup instance:
   aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION

5. Start the ECS service:
   cd $(dirname "$0")
   npx cdk deploy -c desired_count=1 -c vpc_name=custom-vpc -c cluster_name=openclaw-cluster

EOF

# Optionally auto-connect
read -p "Connect to instance now? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  aws ssm start-session --target "$INSTANCE_ID" --region "$REGION"
fi
