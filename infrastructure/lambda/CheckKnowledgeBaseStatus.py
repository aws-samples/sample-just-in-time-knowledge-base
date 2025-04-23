import json
import os
import uuid
import time
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from aws_lambda_powertools.utilities.typing import LambdaContext

# Import common utilities
from common_utils import (
    logger, tracer, metrics, dynamodb, bedrock_agent,
    create_response, handle_options_request, get_user_tenant_from_claims,
    handle_client_error, handle_general_exception
)

# Get environment variables
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID')
DATA_SOURCE_ID = os.environ.get('DATA_SOURCE_ID')
PROJECT_FILES_TABLE = os.environ.get('PROJECT_FILES_TABLE')
KNOWLEDGE_BASE_FILES_TABLE = os.environ.get('KNOWLEDGE_BASE_FILES_TABLE')

# Initialize DynamoDB tables
knowledge_base_files_table = dynamodb.Table(KNOWLEDGE_BASE_FILES_TABLE)
project_files_table = dynamodb.Table(PROJECT_FILES_TABLE) if PROJECT_FILES_TABLE else None

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def handler(event, context: LambdaContext):
    """
    Handler function for checking knowledge base status and ingesting files if needed.
    """
    # Handle OPTIONS request (preflight)
    options_response = handle_options_request(event)
    if options_response:
        return options_response
    
    try:
        # Get the user ID from the Cognito authorizer
        user_id, tenant_id = get_user_tenant_from_claims(event)
        logger.info(f"Processing knowledge base status check for user: {user_id} tenant: {tenant_id}")
        
        # Parse the request body
        body = json.loads(event.get('body', '{}'))
        project_id = body.get('projectId')

        # Get the knowledge base ID from environment variables
        knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
        if not knowledge_base_id:
            logger.error("Knowledge base ID not configured")
            metrics.add_metric(name="MissingKnowledgeBaseId", unit="Count", value=1)
            return create_response(event, 500, {'error': 'Knowledge base ID not configured'})
        
        if not user_id:
            logger.warning("User ID is missing in request")
            return create_response(event, 400, {'error': 'User ID is required'})
        
        if not project_id:
            logger.warning("Report project ID is missing in request")
            return create_response(event, 400, {'error': 'Report project ID is required'})

        logger.info(f"Checking files for project ID: {project_id}")
        selected_files = get_project_files(user_id, tenant_id, project_id)
        if selected_files is None or len(selected_files) == 0:
            logger.warning(f"No files found for project ID: {project_id}")
            metrics.add_metric(name="NoFilesFound", unit="Count", value=1)
            return create_response(event, 400, {'error': 'Project requires files'})
        
        logger.info(f"Found {len(selected_files)} files for project ID: {project_id}")
        ingest_files(user_id, tenant_id, project_id, selected_files)

        metrics.add_metric(name="KnowledgeBaseReady", unit="Count", value=1)
        return create_response(event, 200, { 
            'itemStatus': 'ready',
            'message': 'All files are in the knowledge base'
         })
        
    except ClientError as e:
        return handle_client_error(e, event)
    except Exception as e:
        return handle_general_exception(e, event, "KnowledgeBaseStatusError")

@tracer.capture_method
def get_project_files(user_id, tenant_id, project_id):
    """
    Get files for a tenant id and project ID.
    """
    try:
        if not project_files_table:
            logger.warning("Project files table not configured")
            return None
            
        logger.debug(f"Getting project files for user: {user_id}, tenant: {tenant_id}, project: {project_id}")

        response = project_files_table.query(
            IndexName='tenantId-projectId-index',
            KeyConditionExpression=Key('tenantId').eq(tenant_id) & Key('projectId').eq(project_id)
        )
        
        files = response.get('Items')
        logger.info(f"Found {len(files)} files for report result")
        return files
    except Exception as e:
        logger.warning(f"Error getting report result: {str(e)}")
        metrics.add_metric(name="GetReportResultsError", unit="Count", value=1)
        return None

@tracer.capture_method  
def find_tenant(tenant_id, tenants):
    try:
        return next(tenant for tenant in tenants if tenant['Id'] == tenant_id)
    except StopIteration:
        return None

@tracer.capture_method
def ingest_files(user_id, tenant_id, project_id, files):
    """
    Ingest files into the knowledge base.
    """
    try:
        tenants = json.loads(os.environ.get('TENANTS'))['Tenants']
        tenant = find_tenant(tenant_id, tenants)
        ttl = int(time.time()) + (int(tenant['FilesTTLHours']) * 3600)
    except ValueError:
        logger.warning("Invalid TENANTS value")
        metrics.add_metric(name="InvalidTTLValue", unit="Count", value=1)
        raise ValueError("TENANTS must be a valid json object")

    try:
        logger.info(f"Ingesting {len(files)} files into knowledge base")
        files_ingested = 0
        
        # For each file, create a record in the knowledge base files table and start ingestion
        for file in files:
            file_id = file['id']
            s3_key = file.get('s3Key')
            bucket = file.get('bucket')
            
            logger.info(f"Ingesting file ID: {file_id} from bucket: {bucket}, key: {s3_key}")
            
            # Create a record in the knowledge base files table
            knowledge_base_files_table.put_item(
                Item={
                    'id': file_id,
                    'userId': user_id,
                    'tenantId': tenant_id,
                    'projectId': project_id,
                    'documentStatus': 'ready',
                    'createdAt': int(time.time()),
                    'ttl': ttl
                }
            )
            client_token = str(uuid.uuid4())
            s3_uri = f"s3://{bucket}/{s3_key}"

            # Start the ingestion job
            tracer.put_annotation(key="operation", value="ingest_knowledge_base_documents")
            bedrock_agent.ingest_knowledge_base_documents(
                knowledgeBaseId=KNOWLEDGE_BASE_ID,
                dataSourceId=DATA_SOURCE_ID,
                clientToken=client_token,
                documents=[
                    {
                        'content': {
                            'dataSourceType': 'CUSTOM',
                            'custom': {
                                'customDocumentIdentifier': {
                                    'id': file_id
                                },
                                's3Location': {
                                    'uri': s3_uri
                                },
                                'sourceType': 'S3_LOCATION'
                            }
                        },
                        'metadata': {
                            'type': 'IN_LINE_ATTRIBUTE',
                            'inlineAttributes': [
                                {
                                    'key': 'userId',
                                    'value': {
                                        'stringValue': user_id,
                                        'type': 'STRING'
                                    }
                                },
                                {
                                    'key': 'tenantId',
                                    'value': {
                                        'stringValue': tenant_id,
                                        'type': 'STRING'
                                    }
                                },                                
                                {
                                    'key': 'projectId',
                                    'value': {
                                        'stringValue': project_id,
                                        'type': 'STRING'
                                    }
                                },
                                {
                                    'key': 'fileId',
                                    'value': {
                                        'stringValue': file_id,
                                        'type': 'STRING'
                                    }
                                }
                            ]
                        }
                    }
                ]
            )
            
            files_ingested += 1
            logger.debug(f"Successfully ingested file ID: {file_id}")
        
        logger.info(f"Successfully ingested {files_ingested} files into knowledge base")
        metrics.add_metric(name="FilesIngested", unit="Count", value=files_ingested)

    except Exception as e:
        # Log at warning level since we're re-raising the exception
        logger.warning(f"Error ingesting files: {str(e)}")
        metrics.add_metric(name="IngestFilesError", unit="Count", value=1)
        raise