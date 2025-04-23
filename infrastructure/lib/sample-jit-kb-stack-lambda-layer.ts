import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { Construct } from 'constructs';

export class SampleJITKBStackLambdaLayer extends Construct {
  public readonly layer: lambda.LayerVersion;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Use the pre-built layer zip file
    const layerZipPath = path.join(__dirname, '../lambda/layers-zip/sample-just-in-time-layer.zip');
    
    // Create the boto3 layer from the zip file
    this.layer = new lambda.LayerVersion(this, `${cdk.Stack.of(this).stackName}LambdaLayer`, {
      code: lambda.Code.fromAsset(layerZipPath),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Layer containing boto3 and all other dependencies required',
      license: 'Apache-2.0',
    });
  }
}