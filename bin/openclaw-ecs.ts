#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OpenclawEcsStack } from '../lib/openclaw-ecs-stack';

const app = new cdk.App();

// Configuration from context or defaults
const vpcName = app.node.tryGetContext('vpc_name') || 'openclaw-vpc';
const clusterName = app.node.tryGetContext('cluster_name') || 'openclaw-cluster';

// Deploy to same account/region as pi-hole (ap-southeast-4 Melbourne)
new OpenclawEcsStack(app, 'OpenclawEcsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpcName,
  ecsClusterName: clusterName,
});
