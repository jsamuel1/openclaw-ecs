import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_efs as efs,
  aws_iam as iam,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ClawdbotEcsStackProps extends cdk.StackProps {
  vpcName: string;
  ecsClusterName: string;
}

export class ClawdbotEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ClawdbotEcsStackProps) {
    super(scope, id, props);

    // Lookup existing VPC
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
      vpcName: props.vpcName,
      isDefault: false,
    });

    // Create ECS cluster with managed capacity
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: props.ecsClusterName,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    cluster.addCapacity('ManagedCapacity', {
      instanceType: new ec2.InstanceType('t4g.small'),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(ecs.AmiHardwareType.ARM),
      minCapacity: 0,
      maxCapacity: 1,
      desiredCapacity: 1,
    });

    // Security group for Clawdbot (allow RFC1918 access to gateway port)
    const securityGroup = new ec2.SecurityGroup(this, 'ClawdbotSg', {
      vpc,
      description: 'Clawdbot Gateway security group',
    });
    securityGroup.addIngressRule(
      ec2.Peer.ipv4('10.0.0.0/8'),
      ec2.Port.tcp(18789),
      'Gateway from 10/8'
    );
    securityGroup.addIngressRule(
      ec2.Peer.ipv4('172.16.0.0/12'),
      ec2.Port.tcp(18789),
      'Gateway from 172.16/12'
    );
    securityGroup.addIngressRule(
      ec2.Peer.ipv4('192.168.0.0/16'),
      ec2.Port.tcp(18789),
      'Gateway from 192.168/16'
    );

    // EFS for persistent config and sessions
    const fileSystem = new efs.FileSystem(this, 'ClawdbotEfs', {
      vpc,
      encrypted: true,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const accessPoint = fileSystem.addAccessPoint('ClawdbotAp', {
      path: '/clawdbot',
      createAcl: { ownerGid: '1000', ownerUid: '1000', permissions: '755' },
      posixUser: { gid: '1000', uid: '1000' },
    });

    // Task execution role
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Task role with Bedrock permissions
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Bedrock invoke permissions (all models, including CRIS global endpoints)
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['arn:aws:bedrock:*::foundation-model/*'],
    }));

    // Bedrock discovery permissions (for auto model discovery)
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:ListFoundationModels',
        'bedrock:GetFoundationModel',
      ],
      resources: ['*'],
    }));

    // EFS access
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite',
        'elasticfilesystem:ClientRootAccess',
      ],
      resources: [fileSystem.fileSystemArn],
    }));

    // SSM for ECS Exec
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );

    // Log group
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/clawdbot',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task definition
    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDef', {
      networkMode: ecs.NetworkMode.AWS_VPC,
      taskRole,
      executionRole,
      volumes: [{
        name: 'clawdbot-data',
        efsVolumeConfiguration: {
          fileSystemId: fileSystem.fileSystemId,
          transitEncryption: 'ENABLED',
          authorizationConfig: {
            accessPointId: accessPoint.accessPointId,
            iam: 'ENABLED',
          },
        },
      }],
    });

    const container = taskDefinition.addContainer('clawdbot', {
      image: ecs.ContainerImage.fromRegistry('node:22-slim'),
      memoryReservationMiB: 512,
      cpu: 256,
      essential: true,
      command: [
        'sh', '-c',
        'npm install -g clawdbot@latest && clawdbot gateway run --bind 0.0.0.0 --port 18789',
      ],
      environment: {
        HOME: '/data',
        NODE_ENV: 'production',
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'clawdbot',
        logGroup,
      }),
      portMappings: [{ containerPort: 18789, protocol: ecs.Protocol.TCP }],
    });

    container.addMountPoints({
      sourceVolume: 'clawdbot-data',
      containerPath: '/data',
      readOnly: false,
    });

    // ECS Service
    const service = new ecs.Ec2Service(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      enableExecuteCommand: true,
      securityGroups: [securityGroup],
    });

    // Allow EFS access from service
    fileSystem.connections.allowDefaultPortFrom(service);

    // Outputs
    new cdk.CfnOutput(this, 'EfsFileSystemId', { value: fileSystem.fileSystemId });
    new cdk.CfnOutput(this, 'ServiceName', { value: service.serviceName });
  }
}
