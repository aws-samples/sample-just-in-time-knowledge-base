import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import { SampleJITKBStackOpenSearch } from './sample-jit-kb-stack-opensearch';

export interface SampleJITKBStackKnowledgeBaseProps {
  knowledgeBaseRole: iam.Role;
  prefix: string;
}

export class SampleJITKBStackKnowledgeBase extends Construct {
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly dataSource: bedrock.CfnDataSource;

  constructor(scope: Construct, id: string, props: SampleJITKBStackKnowledgeBaseProps) {
    super(scope, id);

    // Create the OpenSearch resources using the OpenSearchDirect construct
    const openSearchResources = new SampleJITKBStackOpenSearch(this, 'OpenSearchResources', {
      knowledgeBaseRole: props.knowledgeBaseRole,
      prefix: props.prefix
    });
    
    // Create a knowledge base with the OpenSearch Serverless collection
    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: props.prefix,
      description: 'Vector store knowledge base using Titan Text Embeddings V2',
      roleArn: props.knowledgeBaseRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${cdk.Stack.of(this).region}::foundation-model/amazon.titan-embed-text-v2:0`,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: 1024,
              embeddingDataType: 'FLOAT32'
            }
          }
        }
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: openSearchResources.vectorCollection.attrArn,
          fieldMapping: {
            vectorField: 'vector_field',
            textField: 'text_field',
            metadataField: 'metadata_field'
          },
          vectorIndexName: openSearchResources.indexName
        }
      }
    });
    
    // Add dependency to ensure the vector index is created and ready before the knowledge base
    this.knowledgeBase.node.addDependency(openSearchResources.vectorIndex);
    this.knowledgeBase.node.addDependency(openSearchResources.vectorCollection);
    
    // Add explicit dependency on the waitForIndexResource to ensure the index is ready
    this.knowledgeBase.node.addDependency(openSearchResources.waitForIndexResource);

    // Create a data source for the knowledge base
    this.dataSource = new bedrock.CfnDataSource(this, 'KnowledgeBaseDataSource', {
      name: `${props.prefix}-data-source`,
      description: 'S3 data source for just in time knowledge base',
      knowledgeBaseId: this.knowledgeBase.ref,
      dataSourceConfiguration: {
        type: 'CUSTOM'
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'FIXED_SIZE',
          fixedSizeChunkingConfiguration: {
            maxTokens: 300,
            overlapPercentage: 10
          }
        }
      }
    });

    // Add dependency to ensure the knowledge base is created before the data source
    this.dataSource.addDependency(this.knowledgeBase);
  }
}
