import { CfnResource, IAspect, Stack } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { Construct, IConstruct } from 'constructs';

/**
 * Custom aspect to apply cdk-nag suppressions to specific resources
 */
export class NagSuppressionAspect implements IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof Stack) {
      // Add stack level suppressions here
      NagSuppressions.addStackSuppressions(node, [
        { 
          id: 'AwsSolutions-IAM4', 
          reason: 'Managed policies are used for service integration in this sample application' 
        },
      ]);

      // Add specific resource suppressions
      this.addResourceSuppressions(node);
    }
  }

  private addResourceSuppressions(stack: Stack): void {
    // Find resources by logical ID pattern and apply suppressions
    
    // Example: Suppress warnings for S3 buckets with removal policies for development
    const resources = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::S3::Bucket'
    );
    
    if (resources.length > 0) {
      NagSuppressions.addResourceSuppressions(
        resources,
        [
          {
            id: 'AwsSolutions-S1',
            reason: 'Sample application buckets with server access logs disabled for development purposes'
          },
          {
            id: 'AwsSolutions-S10',
            reason: 'Sample application buckets with auto-delete objects for development purposes'
          }
        ],
        true
      );
    }
    
    // Suppress warnings for DynamoDB tables without Point-in-time Recovery
    const dynamoDbTables = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::DynamoDB::Table'
    );
    
    if (dynamoDbTables.length > 0) {
      NagSuppressions.addResourceSuppressions(
        dynamoDbTables,
        [
          {
            id: 'AwsSolutions-DDB3',
            reason: 'Sample application does not require Point-in-time Recovery for demonstration purposes'
          }
        ],
        true
      );
    }

    // Suppress warnings for Lambda functions using AWS managed policies
    const lambdaFunctions = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::Lambda::Function'
    );
    
    if (lambdaFunctions.length > 0) {
      NagSuppressions.addResourceSuppressions(
        lambdaFunctions,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'Lambda functions use AWS managed policies for service integration in this sample application'
          }
        ],
        true
      );
    }

    // Suppress warnings for Lambda roles using AWS managed policies
    const lambdaRoles = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::IAM::Role' &&
      ((construct as CfnResource).logicalId.includes('ServiceRole') || 
       (construct as CfnResource).logicalId.includes('Role'))
    );
    
    if (lambdaRoles.length > 0) {
      NagSuppressions.addResourceSuppressions(
        lambdaRoles,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'IAM roles use AWS managed policies for service integration in this sample application'
          }
        ],
        true
      );
    }

    // Cognito User Pool suppressions
    const userPools = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::Cognito::UserPool'
    );
    
    if (userPools.length > 0) {
      NagSuppressions.addResourceSuppressions(
        userPools,
        [
          {
            id: 'AwsSolutions-COG2',
            reason: 'Sample application with simplified Cognito configuration for development'
          },
          {
            id: 'AwsSolutions-COG3',
            reason: 'Advanced security features require Cognito Plus pricing tier and are not needed for this sample application'
          }
        ],
        true
      );
    }
    
    // Suppress warnings for CDK Bucket Deployment IAM roles
    const bucketDeploymentRoles = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::IAM::Role' &&
      (construct as CfnResource).logicalId.includes('CDKBucketDeployment')
    );
    
    if (bucketDeploymentRoles.length > 0) {
      NagSuppressions.addResourceSuppressions(
        bucketDeploymentRoles,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'CDK Bucket Deployment uses AWS managed policies for Lambda execution'
          }
        ],
        true
      );
    }
    
    // Suppress warnings for API Gateway stages without logging and WAF
    const apiGatewayStages = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::ApiGateway::Stage'
    );
    
    if (apiGatewayStages.length > 0) {
      NagSuppressions.addResourceSuppressions(
        apiGatewayStages,
        [
          {
            id: 'AwsSolutions-APIG6',
            reason: 'API Gateway logging is configured at the deployment level'
          },
          {
            id: 'AwsSolutions-APIG3',
            reason: 'Sample application does not require WAFv2 web ACL integration for demonstration purposes'
          },
          {
            id: 'AwsSolutions-APIG1',
            reason: 'Sample application does not require API Gateway access logging for demonstration purposes'
          }
        ],
        true
      );
    }
    
    // Suppress warnings for CloudFront distributions
    const cloudFrontDistributions = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::CloudFront::Distribution'
    );
    
    if (cloudFrontDistributions.length > 0) {
      NagSuppressions.addResourceSuppressions(
        cloudFrontDistributions,
        [
          {
            id: 'AwsSolutions-CFR4',
            reason: 'CloudFront distribution is configured with TLSv1.2_2021 security policy and SNI SSL support method'
          },
          {
            id: 'AwsSolutions-CFR1',
            reason: 'Sample application does not require geo restrictions for demonstration purposes'
          },
          {
            id: 'AwsSolutions-CFR2',
            reason: 'Sample application does not require WAF integration for demonstration purposes'
          }
        ],
        true
      );
    }
    
    // Suppress warnings for custom resources and AWS Lambda-backed resources
    const customResources = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      ((construct as CfnResource).cfnResourceType === 'AWS::CloudFormation::CustomResource' ||
       (construct as CfnResource).logicalId.includes('AWS679f53fac002430cb0da5b7982bd2287') ||
       (construct as CfnResource).logicalId.includes('LogRetention') ||
       (construct as CfnResource).logicalId.includes('BucketNotifications'))
    );
    
    if (customResources.length > 0) {
      NagSuppressions.addResourceSuppressions(
        customResources,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'Custom resources and AWS Lambda-backed resources use AWS managed policies for service integration'
          },
          {
            id: 'AwsSolutions-IAM5',
            reason: 'Custom resources and AWS Lambda-backed resources require wildcard permissions for their functionality'
          }
        ],
        true
      );
    }
    
    // Find API Gateway resources to add request validation
    const apiGateways = stack.node.findAll().filter(
      construct => construct instanceof CfnResource && 
      (construct as CfnResource).cfnResourceType === 'AWS::ApiGateway::RestApi'
    );
    
    if (apiGateways.length > 0) {
      NagSuppressions.addResourceSuppressions(
        apiGateways,
        [
          {
            id: 'AwsSolutions-APIG2',
            reason: 'Sample application uses Cognito authorizer for API security instead of request validation'
          }
        ],
        true
      );
    }
  }
}
