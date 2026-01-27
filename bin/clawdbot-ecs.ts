#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClawdbotEcsStack } from '../lib/clawdbot-ecs-stack';

const app = new cdk.App();

// Configuration from context or defaults
const vpcName = app.node.tryGetContext('vpc_name') || 'clawdbot-vpc';
const clusterName = app.node.tryGetContext('cluster_name') || 'clawdbot-cluster';

// Deploy to same account/region as pi-hole (ap-southeast-4 Melbourne)
new ClawdbotEcsStack(app, 'ClawdbotEcsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpcName,
  ecsClusterName: clusterName,
});
