#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OpenclawEcsStack } from '../lib/openclaw-ecs-stack';

const app = new cdk.App();

// Configuration from context or defaults
const vpcName = app.node.tryGetContext('vpc_name') || 'openclaw-vpc';
const clusterName = app.node.tryGetContext('cluster_name') || 'openclaw-cluster';
const desiredCount = parseInt(app.node.tryGetContext('desired_count') || '0', 10);

new OpenclawEcsStack(app, 'OpenclawEcsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpcName,
  ecsClusterName: clusterName,
  desiredCount,
});
