import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';
import { SampleJITKBStackProps as SampleJITKBStackProps } from './sample-jit-kb-stack-props';
import { SampleJITKBStackLambdaLayer as SampleJITKBStackLambdaLayer } from './sample-jit-kb-stack-lambda-layer';
import { SampleJITKBStackKnowledgeBase } from './sample-jit-kb-stack-knowledge-base';
import { tenants } from './sample-jit-kb-tenants-config';

export class SampleJITKBStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: SampleJITKBStackProps) {
    super(scope, id, props);

    // Default to false if not provided
    const enableLocalhost = props?.enableLocalhost ?? false;
    const prefix = props?.prefix ?? 'sample-jit-kb';
    console.log('enableLocalhost:', enableLocalhost);
    console.log('Prefix:', prefix);
    console.log('Stack Name:', this.stackName);
    console.log('Tenant Information:', tenants);

    // Create the boto3 layer to be used by all Python Lambda functions
    const sampleJITKBStackLambdaLayer = new SampleJITKBStackLambdaLayer(this, `${this.stackName}LambdaLayer`).layer;

    // Create S3 bucket for website hosting (no public access needed)
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Only for development
      autoDeleteObjects: true, // Only for development
      enforceSSL: true, // Enforce SSL/TLS for data in transit
      encryption: s3.BucketEncryption.S3_MANAGED, // Enable server-side encryption by default
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED, // Enforce object ownership
    });

    // Create S3 bucket for CloudFront access logs
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Only for development
      autoDeleteObjects: true, // Only for development
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      // CloudFront logging requires ACLs to be enabled
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER, // Allow the CloudFront logging service to write logs
    });

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        }
      ],
      // Enable access logging for CloudFront distribution (AwsSolutions-CFR3)
      enableLogging: true,
      logBucket: accessLogsBucket,
      logFilePrefix: 'cloudfront-logs/',
      // Set minimum TLS version to 1.2 (AwsSolutions-CFR4)
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // Explicitly configure certificate to ensure TLS compliance
      sslSupportMethod: cloudfront.SSLMethod.SNI,
    });

    // Create Cognito User Pool
    const userPool = new cognito.UserPool(this, `${this.stackName}UserPool`, {
      selfSignUpEnabled: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Only for development
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.LINK,
        emailSubject: 'Verify your email for the sample',
        emailBody: 'Please click the link below to verify your email address: {##Verify Email##}',
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        tenantId: new cognito.StringAttribute({ mutable: true }),
      },
      autoVerify: {
        email: true, // Enable auto-verification of email
      },
      signInAliases: {
        email: true, // Allow users to sign in with email
      },
      // Add password policy to satisfy AwsSolutions-COG1
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3)
      }
    });

    const domain = userPool.addDomain(`${this.stackName}Domain`, {
      cognitoDomain: {
        domainPrefix: prefix + '-' + this.account,
      },
    });

    const projectsTable = new dynamodb.Table(this, 'ProjectsTable', {
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Only for development
    });

    const projectFilesTable = new dynamodb.Table(this, 'ProjectFilesTable', {
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Only for development
    });

    // Add the Global Secondary Index
    projectFilesTable.addGlobalSecondaryIndex({
      indexName: 'tenantId-projectId-index',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'projectId',
        type: dynamodb.AttributeType.STRING
      }
    });

    // Create a new table for tracking knowledge base ingested files with TTL
    const knowledgeBaseFilesTable = new dynamodb.Table(this, 'KnowledgeBaseFilesTable', {
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Enable TTL for automatic document expiration
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable DynamoDB Streams
    });

    // Add the Global Secondary Index
    knowledgeBaseFilesTable.addGlobalSecondaryIndex({
      indexName: 'tenantId-projectId-index',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'projectId',
        type: dynamodb.AttributeType.STRING
      }
    });

    // Create a new table for storing chat history
    const chatHistoryTable = new dynamodb.Table(this, 'ChatHistoryTable', {
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add the Global Secondary Index
    chatHistoryTable.addGlobalSecondaryIndex({
      indexName: 'tenantId-userId-index',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING
      }
    });

    // Create User Pool Client
    const userPoolClient = userPool.addClient(`${this.stackName}Client`, {
      oAuth: {
        flows: {
          authorizationCodeGrant: true, // Use authorization code grant flow
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [
          `https://${distribution.distributionDomainName}`,
          // Only add localhost if enabled
          ...(enableLocalhost ? ['http://localhost:8000'] : []),
        ],
        logoutUrls: [
          `https://${distribution.distributionDomainName}`,
          // Only add localhost if enabled
          ...(enableLocalhost ? ['http://localhost:8000'] : []),
        ],
      },
      generateSecret: false, // Set to true if using a server-side app
    });

    // Create Identity Pool
    const identityPool = new cognito.CfnIdentityPool(this, `${this.stackName}IdentityPool`, {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: userPoolClient.userPoolClientId,
        providerName: userPool.userPoolProviderName,
        serverSideTokenCheck: true
      }]
    });

    const allowHeaders = enableLocalhost
      ? 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Origin'
      : 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token';

    const allowOrigins = enableLocalhost
      ? `https://${distribution.distributionDomainName},http://localhost:8000`
      : `https://${distribution.distributionDomainName}`;

    const userFilesBucket = new s3.Bucket(this, 'UserFilesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Only for development
      autoDeleteObjects: true // Only for development
    });

    // Add CORS configuration if needed
    userFilesBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
      allowedOrigins: enableLocalhost
        ? [`https://${distribution.distributionDomainName}`, 'http://localhost:8000']
        : [`https://${distribution.distributionDomainName}`],
      allowedHeaders: ['*'],
      maxAge: 3000
    });

    // Create the knowledge base role with least privilege permissions
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        knowledgeBasePolicy: new iam.PolicyDocument({
          statements: [
            // Bedrock permissions for knowledge base operations
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:GetKnowledgeBase',
                'bedrock:StartIngestionJob',
                'bedrock:GetIngestionJob',
                'bedrock:ListIngestionJobs',
                'bedrock:IngestKnowledgeBaseDocuments',
                'bedrock:DeleteKnowledgeBaseDocuments',
                'bedrock:Retrieve',
                'bedrock:RetrieveAndGenerate'
              ],
              resources: [
                // Specific to the knowledge base being created
                `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:knowledge-base/*`
              ]
            }),
            // Bedrock model invocation permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel'
              ],
              resources: [
                // Claude models used for embeddings and retrieval
                `arn:aws:bedrock:${cdk.Stack.of(this).region}::foundation-model/*`
              ]
            }),
            // OpenSearch Serverless permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll',
                'aoss:BatchGetCollection',
                'aoss:CreateCollection',
                'aoss:CreateSecurityPolicy',
                'aoss:GetAccessPolicy',
                'aoss:UpdateAccessPolicy',
                'aoss:CreateAccessPolicy',
                'aoss:GetSecurityPolicy',
                'aoss:UpdateSecurityPolicy'
              ],
              resources: [
                // Specific to collections in this account
                `arn:aws:aoss:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:collection/*`
              ]
            }),
            // OpenSearch data access permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:ReadDocument',
                'aoss:WriteDocument',
                'aoss:DeleteDocument',
                'aoss:CreateIndex',
                'aoss:DeleteIndex',
                'aoss:UpdateIndex'
              ],
              resources: [
                // Specific to collections and indexes in this account
                `arn:aws:aoss:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:collection/*`
              ]
            })
          ]
        })
      }
    });

    // Grant S3 read permissions to the knowledge base role
    userFilesBucket.grantRead(knowledgeBaseRole);

    // Create the OpenSearch and Knowledge Base resources
    const knowledgeBaseStack = new SampleJITKBStackKnowledgeBase(this, `${this.stackName}OpenSearchStack`, {
      knowledgeBaseRole: knowledgeBaseRole,
      prefix: prefix
    });

    // Common PowerTools environment variables
    const powertoolsEnv = {
      POWERTOOLS_SERVICE_NAME: `${this.stackName}`,
      POWERTOOLS_METRICS_NAMESPACE: `${this.stackName}LambdaMetrics`,
      LOG_LEVEL: 'INFO',
      POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      POWERTOOLS_LOGGER_SAMPLE_RATE: '0.1',
      POWERTOOLS_TRACER_CAPTURE_RESPONSE: 'true',
      POWERTOOLS_TRACER_CAPTURE_ERROR: 'true',
    };

    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${cdk.Stack.of(this).region}:017000801446:layer:AWSLambdaPowertoolsPythonV3-python312-x86_64:8`
    );

    const projectsFunction = new lambda.Function(this, 'ProjectsFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'Projects.handler',
      memorySize: 2048,
      timeout: cdk.Duration.minutes(2),
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      layers: [powertoolsLayer, sampleJITKBStackLambdaLayer],
      environment: {
        USER_FILES_BUCKET: userFilesBucket.bucketName,
        PROJECTS_TABLE_NAME: projectsTable.tableName,
        PROJECT_FILES_TABLE: projectFilesTable.tableName,
        ALLOW_ORIGINS: allowOrigins,
        ALLOW_HEADERS: allowHeaders,
        KNOWLEDGE_BASE_ID: knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: knowledgeBaseStack.dataSource.attrDataSourceId,
        // Add PowerTools environment variables
        ...powertoolsEnv
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH
    });

    projectsTable.grantReadWriteData(projectsFunction);
    projectFilesTable.grantReadWriteData(projectsFunction);
    userFilesBucket.grantReadWrite(projectsFunction);

    // Add permissions for Bedrock knowledge base operations to remove items from KB
    projectsFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:DeleteKnowledgeBaseDocuments',
        'bedrock:StartIngestionJob',
        'bedrock:GetKnowledgeBase'
      ],
      resources: [
        // Specific to the knowledge base being created
        `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:knowledge-base/${knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId}`
      ]
    }));


    const projectFilesFunction = new lambda.Function(this, 'ProjectFilesFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'ProjectFiles.handler',
      memorySize: 2048,
      timeout: cdk.Duration.minutes(2),
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      layers: [powertoolsLayer, sampleJITKBStackLambdaLayer],
      environment: {
        USER_FILES_BUCKET: userFilesBucket.bucketName,
        PROJECT_FILES_TABLE: projectFilesTable.tableName,
        ALLOW_ORIGINS: allowOrigins,
        ALLOW_HEADERS: allowHeaders,
        KNOWLEDGE_BASE_ID: knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: knowledgeBaseStack.dataSource.attrDataSourceId,
        // Add PowerTools environment variables
        ...powertoolsEnv
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH
    });

    projectFilesTable.grantReadWriteData(projectFilesFunction);
    userFilesBucket.grantReadWrite(projectFilesFunction);

    // Add permissions for Bedrock knowledge base operations
    projectFilesFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:DeleteKnowledgeBaseDocuments',
        'bedrock:StartIngestionJob',
        'bedrock:GetKnowledgeBase'
      ],
      resources: [
        // Specific to the knowledge base being created
        `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:knowledge-base/${knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId}`
      ]
    }));

    // Create a Lambda function for querying the knowledge base
    const queryKnowledgeBaseFunction = new lambda.Function(this, 'QueryKnowledgeBaseFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'QueryKnowledgeBase.handler',
      memorySize: 2048,
      timeout: cdk.Duration.minutes(2),
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      layers: [powertoolsLayer, sampleJITKBStackLambdaLayer],
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: knowledgeBaseStack.dataSource.attrDataSourceId,
        ALLOW_ORIGINS: allowOrigins,
        ALLOW_HEADERS: allowHeaders,
        PROJECT_FILES_TABLE: projectFilesTable.tableName,
        CHAT_HISTORY_TABLE: chatHistoryTable.tableName,
        // Add PowerTools environment variables
        ...powertoolsEnv
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH
    });
    projectFilesTable.grantReadData(queryKnowledgeBaseFunction);
    projectsTable.grantReadData(queryKnowledgeBaseFunction);
    chatHistoryTable.grantReadWriteData(queryKnowledgeBaseFunction);

    // Add permissions for Bedrock knowledge base operations
    queryKnowledgeBaseFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:Retrieve',
        'bedrock:RetrieveAndGenerate',
        'bedrock:GetKnowledgeBase'
      ],
      resources: [
        // Specific to the knowledge base being created
        `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:knowledge-base/${knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId}`
      ]
    }));
    
    // Add permission for model invocation
    queryKnowledgeBaseFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel'
      ],
      resources: [
        // Claude models used for embeddings and retrieval
        `arn:aws:bedrock:${cdk.Stack.of(this).region}::foundation-model/*`
      ]
    }));

    // Create a Lambda function for checking knowledge base status
    const checkKnowledgeBaseStatusFunction = new lambda.Function(this, 'CheckKnowledgeBaseStatusFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'CheckKnowledgeBaseStatus.handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(1),
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      layers: [powertoolsLayer, sampleJITKBStackLambdaLayer],
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: knowledgeBaseStack.dataSource.attrDataSourceId,
        ALLOW_ORIGINS: allowOrigins,
        ALLOW_HEADERS: allowHeaders,
        PROJECT_FILES_TABLE: projectFilesTable.tableName,
        KNOWLEDGE_BASE_FILES_TABLE: knowledgeBaseFilesTable.tableName,
        TENANTS: JSON.stringify({ Tenants: tenants }),
        // Add PowerTools environment variables
        ...powertoolsEnv
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH
    });

    // Grant permissions for the check status function
    knowledgeBaseFilesTable.grantReadWriteData(checkKnowledgeBaseStatusFunction);
    projectFilesTable.grantReadData(checkKnowledgeBaseStatusFunction);

    // Add permissions for Bedrock knowledge base operations for the check status function
    checkKnowledgeBaseStatusFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:GetKnowledgeBase',
        'bedrock:IngestKnowledgeBaseDocuments',
        'bedrock:StartIngestionJob'
      ],
      resources: [
        // Specific to the knowledge base being created
        `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:knowledge-base/${knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId}`
      ]
    }));

    // Create a Lambda function to handle TTL-expired documents
    const cleanupKnowledgeBaseFunction = new lambda.Function(this, 'CleanupKnowledgeBaseFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'CleanupKnowledgeBase.lambda_handler',
      memorySize: 512,
      timeout: cdk.Duration.minutes(1),
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      layers: [powertoolsLayer, sampleJITKBStackLambdaLayer],
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: knowledgeBaseStack.dataSource.attrDataSourceId,
        KNOWLEDGE_BASE_FILES_TABLE: knowledgeBaseFilesTable.tableName,
        // Add PowerTools environment variables
        ...powertoolsEnv
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH
    });

    // Grant permissions to the cleanup function
    knowledgeBaseFilesTable.grantReadWriteData(cleanupKnowledgeBaseFunction);
    cleanupKnowledgeBaseFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:DeleteKnowledgeBaseDocuments',
        'bedrock:StartIngestionJob',
        'bedrock:GetKnowledgeBase'
      ],
      resources: [
        // Specific to the knowledge base being created
        `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:knowledge-base/${knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId}`
      ]
    }));

    // Configure the Lambda function to be triggered by DynamoDB Streams
    // This will capture TTL expirations through the stream
    cleanupKnowledgeBaseFunction.addEventSource(new lambdaEventSources.DynamoEventSource(knowledgeBaseFilesTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      retryAttempts: 3,
      filters: [
        lambda.FilterCriteria.filter({
          eventName: lambda.FilterRule.isEqual('REMOVE'),
          // Filter for TTL expirations specifically
          userIdentity: {
            type: lambda.FilterRule.isEqual('Service'),
            principalId: lambda.FilterRule.isEqual('dynamodb.amazonaws.com')
          }
        })
      ]
    }));

    const api = new apigw.RestApi(this, `${this.stackName}Api`, {
      defaultCorsPreflightOptions: {
        allowOrigins: enableLocalhost
          ? [
            `https://${distribution.distributionDomainName}`,
            'http://localhost:8000'
          ]
          : [`https://${distribution.distributionDomainName}`],
        allowMethods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token'
        ],
        allowCredentials: true
      }
    });
    
    // Add request validation to address AwsSolutions-APIG2
    const basicValidator = api.addRequestValidator('basicValidator', {
      validateRequestBody: true,
      validateRequestParameters: true
    });

    const auth = new apigateway.CognitoUserPoolsAuthorizer(this, 'APIAuthorizer', {
      cognitoUserPools: [userPool]
    });

    // Add the API Gateway resources and methods
    const projectFilesAPI = api.root.addResource('project-files');

    // Add a resource for uploading files
    // POST /project-files
    projectFilesAPI.addMethod('POST', new apigw.LambdaIntegration(projectFilesFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('ProjectFilesPostValidator', {
        validateRequestBody: true
      })
    });

    // Add a resource for getting files by project ID
    // GET /project-files/{projectId}
    const projectIdFiles = projectFilesAPI.addResource('{projectId}');
    projectIdFiles.addMethod('GET', new apigw.LambdaIntegration(projectFilesFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('ProjectIdFilesGetValidator', {
        validateRequestParameters: true
      })
    });
    projectIdFiles.addMethod('POST', new apigw.LambdaIntegration(projectFilesFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('ProjectIdFilesPostValidator', {
        validateRequestBody: true
      })
    });

    // Add a resource for operations on single files
    // GET/DELETE /project-files/{projectId}/{id}
    const singleProjectFile = projectIdFiles.addResource('{id}');
    singleProjectFile.addMethod('GET', new apigw.LambdaIntegration(projectFilesFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('SingleProjectFileGetValidator', {
        validateRequestParameters: true
      })
    });
    singleProjectFile.addMethod('DELETE', new apigw.LambdaIntegration(projectFilesFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('SingleProjectFileDeleteValidator', {
        validateRequestParameters: true
      })
    });

    // GET presigned url /project-files/{projectId}/download/{id}
    const projectDownloadFile = projectIdFiles.addResource('download').addResource('{id}');
    projectDownloadFile.addMethod('GET', new apigw.LambdaIntegration(projectFilesFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('ProjectDownloadFileGetValidator', {
        validateRequestParameters: true
      })
    });

    const projectsAPI = api.root.addResource('projects');

    // GET /projects (list all)
    projectsAPI.addMethod('GET', new apigw.LambdaIntegration(projectsFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('ProjectsGetValidator', {
        validateRequestParameters: true
      })
    });

    // POST /projects (create new)
    projectsAPI.addMethod('POST', new apigw.LambdaIntegration(projectsFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('ProjectsPostValidator', {
        validateRequestBody: true
      })
    });

    // GET /projects/{id} (get single)
    const singleProjectAPI = projectsAPI.addResource('{id}');
    singleProjectAPI.addMethod('GET', new apigw.LambdaIntegration(projectsFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('SingleProjectGetValidator', {
        validateRequestParameters: true
      })
    });
    singleProjectAPI.addMethod('DELETE', new apigw.LambdaIntegration(projectsFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('SingleProjectDeleteValidator', {
        validateRequestParameters: true
      })
    });

    // Add the API Gateway resource and method for knowledge base queries
    const knowledgeBaseAPI = api.root.addResource('knowledge-base');
    const queryResource = knowledgeBaseAPI.addResource('query');
    queryResource.addMethod('POST', new apigw.LambdaIntegration(queryKnowledgeBaseFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('KnowledgeBaseQueryValidator', {
        validateRequestBody: true
      })
    });

    // Add a new endpoint for checking knowledge base status
    const statusResource = knowledgeBaseAPI.addResource('status');
    statusResource.addMethod('POST', new apigw.LambdaIntegration(checkKnowledgeBaseStatusFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('KnowledgeBaseStatusValidator', {
        validateRequestBody: true
      })
    });

    // GET/DELETE /history
    const knowledgeBaseChatHistoryResource = knowledgeBaseAPI.addResource('history');
    const reportResultKnowledgeBaseChatHistoryResource = knowledgeBaseChatHistoryResource.addResource('{id}');
    reportResultKnowledgeBaseChatHistoryResource.addMethod('GET', new apigw.LambdaIntegration(queryKnowledgeBaseFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('KnowledgeBaseHistoryGetValidator', {
        validateRequestParameters: true
      })
    });
    reportResultKnowledgeBaseChatHistoryResource.addMethod('DELETE', new apigw.LambdaIntegration(queryKnowledgeBaseFunction), {
      authorizer: auth,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidator: api.addRequestValidator('KnowledgeBaseHistoryDeleteValidator', {
        validateRequestParameters: true
      })
    });

    const configContent = JSON.stringify({
      UserPoolId: userPool.userPoolId,
      IdentityPoolId: identityPool.ref,
      ClientId: userPoolClient.userPoolClientId,
      Region: cdk.Stack.of(this).region,
      CognitoDomain: domain.baseUrl(),
      API: api.url,
      Tenants: tenants
    });

    // Deploy static website files to S3
    new s3deploy.BucketDeployment(this, 'WebsiteDeploymentBucket', {
      sources: [
        s3deploy.Source.asset('../website/dist'),
        s3deploy.Source.data('config.js', `window.config = ${configContent};`)
      ],
      destinationBucket: websiteBucket,
      memoryLimit: 2048
    });

    // Output values
    new cdk.CfnOutput(this, `${this.stackName}_UserPoolId`, { value: userPool.userPoolId });
    new cdk.CfnOutput(this, `${this.stackName}_UserPoolClientId`, { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, `${this.stackName}_IdentityPoolId`, { value: identityPool.ref });
    new cdk.CfnOutput(this, `${this.stackName}_DistributionDomainName`, { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, `${this.stackName}_DistributionId`, { value: distribution.distributionId });
    new cdk.CfnOutput(this, `${this.stackName}_CognitoDomain`, { value: domain.baseUrl() });
    new cdk.CfnOutput(this, `${this.stackName}_EnableLocalhost`, { value: enableLocalhost.toString() });
    new cdk.CfnOutput(this, `${this.stackName}_WebsiteBucket`, { value: websiteBucket.bucketName });
    new cdk.CfnOutput(this, `${this.stackName}_UserFilesBucket`, { value: userFilesBucket.bucketName });
    new cdk.CfnOutput(this, `${this.stackName}_ProjectsTableName`, { value: projectsTable.tableName });
    new cdk.CfnOutput(this, `${this.stackName}_ProjectFilesTableName`, { value: projectFilesTable.tableName });
    new cdk.CfnOutput(this, `${this.stackName}_KnowledgeBaseFilesTableName`, { value: knowledgeBaseFilesTable.tableName });
    new cdk.CfnOutput(this, `${this.stackName}_ChatHistoryTableName`, { value: chatHistoryTable.tableName });
    new cdk.CfnOutput(this, `${this.stackName}_ApiUrl`, { value: api.url });
    new cdk.CfnOutput(this, `${this.stackName}_KnowledgeBaseId`, { value: knowledgeBaseStack.knowledgeBase.attrKnowledgeBaseId });
    new cdk.CfnOutput(this, `${this.stackName}_KnowledgeBaseDataSourceId`, { value: knowledgeBaseStack.dataSource.attrDataSourceId });
    new cdk.CfnOutput(this, `${this.stackName}_ConfigDownloadCommand`, { 
      value: `aws s3 cp s3://${websiteBucket.bucketName}/config.js ./website/config.js --region ${this.region}` 
    });
  }
}
