import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_efs as efs,
  aws_iam as iam,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface OpenclawEcsStackProps extends cdk.StackProps {
  vpcName: string;
  ecsClusterName: string;
}

export class OpenclawEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OpenclawEcsStackProps) {
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
      minCapacity: 1,
      maxCapacity: 2,
      desiredCapacity: 1,
    });

    // Security group for OpenClaw (allow RFC1918 access to gateway port)
    const securityGroup = new ec2.SecurityGroup(this, 'OpenclawSg', {
      vpc,
      description: 'OpenClaw Gateway security group',
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
    const fileSystem = new efs.FileSystem(this, 'OpenclawEfs', {
      vpc,
      encrypted: true,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const accessPoint = fileSystem.addAccessPoint('OpenclawAp', {
      path: '/openclaw',
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
      logGroupName: '/ecs/openclaw',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task definition
    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDef', {
      networkMode: ecs.NetworkMode.AWS_VPC,
      taskRole,
      executionRole,
      volumes: [{
        name: 'openclaw-data',
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

    const container = taskDefinition.addContainer('openclaw', {
      image: ecs.ContainerImage.fromRegistry(
        `${this.account}.dkr.ecr.${this.region}.amazonaws.com/openclaw:latest`
      ),
      memoryReservationMiB: 1024,
      cpu: 512,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'openclaw',
        logGroup,
      }),
      portMappings: [{ containerPort: 18789, protocol: ecs.Protocol.TCP }],
    });

    container.addMountPoints({
      sourceVolume: 'openclaw-data',
      containerPath: '/data',
      readOnly: false,
    });

    // ECS Service with rolling deployment
    const service = new ecs.Ec2Service(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      enableExecuteCommand: true,
      securityGroups: [securityGroup],
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
    });

    // Allow EFS access from service
    fileSystem.connections.allowDefaultPortFrom(service);

    // Outputs
    new cdk.CfnOutput(this, 'EfsFileSystemId', { value: fileSystem.fileSystemId });
    new cdk.CfnOutput(this, 'ServiceName', { value: service.serviceName });
  }
}
