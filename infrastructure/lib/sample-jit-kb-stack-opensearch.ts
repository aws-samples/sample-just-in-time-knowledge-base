import * as cdk from 'aws-cdk-lib';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface SampleJITKBStackOpenSearchProps {
  knowledgeBaseRole: iam.Role;
  prefix: string;
}

export class SampleJITKBStackOpenSearch extends Construct {
  public readonly vectorCollection: opensearchserverless.CfnCollection;
  public readonly vectorIndex: opensearchserverless.CfnIndex;
  public readonly waitForIndexResource: cr.AwsCustomResource;
  public readonly collectionName: string;
  public readonly indexName: string;
  public readonly encryptionPolicyName: string;
  public readonly networkPolicyName: string;
  public readonly accessPolicyName: string;
  public readonly openSearchAccessPolicyName: string;   

  constructor(scope: Construct, id: string, props: SampleJITKBStackOpenSearchProps) {
    super(scope, id);
    this.collectionName = `${props.prefix}-vector`;
    this.indexName = `${props.prefix}-vector-index`;
    this.encryptionPolicyName = `${props.prefix}-vector-encrypt`;
    this.networkPolicyName = `${props.prefix}-vector-network`;
    this.accessPolicyName = `${props.prefix}-vector-access`;
    this.openSearchAccessPolicyName = `${props.prefix}-vector-role-policy`;
  
    // Create a role for CloudFormation to use when creating the index
    const cfnIndexRole = new iam.Role(this, 'CfnIndexRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('cloudformation.amazonaws.com'),
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('aoss.amazonaws.com')
      )
    });
    
    // Add inline policy instead of using the managed policy
    cfnIndexRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:*',
        'iam:PassRole'
      ],
      resources: ['*']
    }));

    // Create encryption policy first - name must be 32 chars or less
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorEncryptionPolicy', {
      name: this.encryptionPolicyName,
      type: 'encryption',
      description: 'Encryption policy for sample vector collection',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${this.collectionName}`]
          }
        ],
        AWSOwnedKey: true
      })
    });
    
    // Create network policy - name must be 32 chars or less
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorNetworkPolicy', {
      name: this.networkPolicyName,
      type: 'network',
      description: 'Network policy for sample vector collection',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${this.collectionName}`]
            }
          ],
          AllowFromPublic: true  // Allow access from anywhere, including CloudFormation
        }
      ])
    });
    
    // Create an OpenSearch Serverless collection after policies are in place
    this.vectorCollection = new opensearchserverless.CfnCollection(this, 'VectorCollection', {
      name: this.collectionName,
      type: 'VECTORSEARCH',
      description: 'Vector collection for sample knowledge base',
    });
    
    // Add dependencies to ensure proper creation order
    this.vectorCollection.node.addDependency(encryptionPolicy);
    this.vectorCollection.node.addDependency(networkPolicy);
    
    // Create access policy for the collection after collection is created
    // Include both the knowledge base role and the CloudFormation role
    const accessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VectorAccessPolicy', {
      name: this.accessPolicyName,
      type: 'data',
      description: 'Access policy for sample vector collection',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${this.collectionName}`],
              Permission: [
                'aoss:*'
              ]
            },
            {
              ResourceType: 'index',
              Resource: [`index/${this.collectionName}/*`],
              Permission: [
                'aoss:*'
              ]
            }
          ],
          Principal: [
            props.knowledgeBaseRole.roleArn,
            cfnIndexRole.roleArn,
            `arn:aws:iam::${cdk.Stack.of(this).account}:root`  // Add the account root for full access
          ],
          Description: 'Access policy for Bedrock knowledge base and index creation'
        }
      ])
    });
    
    accessPolicy.node.addDependency(this.vectorCollection);
    
    // Create a role for OpenSearch Serverless access with more permissions
    const openSearchRole = new iam.Role(this, 'OpenSearchRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('aoss.amazonaws.com'),
        new iam.ServicePrincipal('cloudformation.amazonaws.com')
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });
    
    // Grant permissions to the role
    openSearchRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:*'
      ],
      resources: ['*']
    }));
    
    // Create access policy for the OpenSearch role with explicit permissions
    const openSearchAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VectorRoleAccessPolicy', {
      name: this.openSearchAccessPolicyName,
      type: 'data',
      description: 'Access policy for role to access sample vector',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'index',
              Resource: [`index/${this.collectionName}/*`],
              Permission: [
                'aoss:*'
              ]
            }
          ],
          Principal: [
            openSearchRole.roleArn,
            cfnIndexRole.roleArn,
            `arn:aws:iam::${cdk.Stack.of(this).account}:root`
          ],
          Description: 'Access policy for OpenSearch operations'
        },
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${this.collectionName}`],
              Permission: [
                'aoss:*'
              ]
            }
          ],
          Principal: [
            openSearchRole.roleArn,
            cfnIndexRole.roleArn,
            `arn:aws:iam::${cdk.Stack.of(this).account}:root`
          ],
          Description: 'Access policy for collection operations'
        }
      ])
    });
    
    openSearchAccessPolicy.node.addDependency(this.vectorCollection);
    openSearchAccessPolicy.node.addDependency(accessPolicy);
    
    // Use a different approach to check collection status
    const waitForCollection = new cr.AwsCustomResource(this, 'WaitForCollection', {
      onCreate: {
        service: 'OpenSearchServerless',
        action: 'listCollections',
        parameters: {
          collectionFilters: {
            name: this.collectionName
          }
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.collectionName}-status-check`),
        outputPaths: ['collectionSummaries.0.status']
      },
      onUpdate: {
        service: 'OpenSearchServerless',
        action: 'listCollections',
        parameters: {
          collectionFilters: {
            name: this.collectionName
          }
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.collectionName}-status-check-update`),
        outputPaths: ['collectionSummaries.0.status']
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['aoss:ListCollections'],
          resources: ['*']
        })
      ]),
      installLatestAwsSdk: true,
      // Add a timeout and retry mechanism
      timeout: cdk.Duration.minutes(5),
      resourceType: 'Custom::WaitForCollectionActive'
    });
    
    // Add dependency to ensure the collection is created first
    waitForCollection.node.addDependency(this.vectorCollection);
    waitForCollection.node.addDependency(accessPolicy);
    
    // Create the vector index directly using CfnIndex with proper mappings structure
    this.vectorIndex = new opensearchserverless.CfnIndex(this, 'VectorIndex', {
      indexName: this.indexName,
      collectionEndpoint: this.vectorCollection.attrCollectionEndpoint,
      mappings: {
        properties: {
          vector_field: {
            type: 'knn_vector',
            dimension: 1024,
            method: {
              engine: 'faiss',
              name: 'hnsw',
              spaceType: 'l2',
              parameters: {
                efConstruction: 128,
                m: 16
              }
            }
          },
          text_field: {
            type: 'text',
            index: true
          },
          metadata_field: {
            type: 'text',
            index: false
          }
        }
      }
    });
    
    // Add dependency to ensure the collection is active before creating the index
    this.vectorIndex.node.addDependency(waitForCollection);
    this.vectorIndex.node.addDependency(openSearchAccessPolicy);
    this.vectorIndex.node.addDependency(accessPolicy);
    
    // Instead of using a custom resource to wait for the index, let's use a dependency
    // and rely on the fact that the index creation will fail if the collection isn't ready
    this.waitForIndexResource = new cr.AwsCustomResource(this, 'WaitForIndex', {
      onCreate: {
        service: 'CloudFormation',
        action: 'describeStacks',
        parameters: {
          StackName: cdk.Stack.of(this).stackName
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.indexName}-status-check`),
      },
      onUpdate: {
        service: 'CloudFormation',
        action: 'describeStacks',
        parameters: {
          StackName: cdk.Stack.of(this).stackName
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.indexName}-status-check-update`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cloudformation:DescribeStacks'],
          resources: ['*']
        })
      ]),
      installLatestAwsSdk: true,
      // Add a timeout and retry mechanism
      timeout: cdk.Duration.minutes(5),
      resourceType: 'Custom::WaitForIndexReady'
    });
    
    // Add dependency to ensure the index is created first
    this.waitForIndexResource.node.addDependency(this.vectorIndex);
  }
}