#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SampleJITKBStack as SampleJITKBStack } from '../lib/sample-jit-kb-stack';
import { NagSuppressionAspect } from '../lib/cdk-nag-config';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

const app = new cdk.App();

// Add cdk-nag AwsSolutions Pack
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Add our custom suppression aspect
cdk.Aspects.of(app).add(new NagSuppressionAspect());

const enableLocalhost = app.node.tryGetContext('enableLocalhost') === 'true';
const prefix = app.node.tryGetContext('prefix') || 'sample-jit-kb';
const stackName = app.node.tryGetContext('stackName') || 'SampleJITKB';

const stack = new SampleJITKBStack(app, 'SampleJITKBStack', {
  enableLocalhost: enableLocalhost,
  prefix: prefix,
  stackName: stackName,
  description: 'AWS Sample Code (uksb-7mdw5l0lhh)'
});

// Add stack-level suppressions if needed
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-IAM5', reason: 'IAM policies use wildcards for service integration in sample application' },
  { id: 'AwsSolutions-L1', reason: 'Lambda functions use latest runtime versions' }
]);