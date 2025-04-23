import json
import os
import uuid
import time
from boto3.dynamodb.conditions import Key
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError

# Import common utilities
from common_utils import (
    logger, tracer, metrics, dynamodb, s3, bedrock_agent,
    create_response, handle_options_request, get_user_tenant_from_claims,
    handle_client_error, handle_general_exception
)

# Initialize DynamoDB tables
table = dynamodb.Table(os.environ['PROJECTS_TABLE_NAME'])
project_files_table = dynamodb.Table(os.environ['PROJECT_FILES_TABLE'])

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def handler(event, context: LambdaContext):
    try:
        # Check if this is a preflight OPTIONS request
        options_response = handle_options_request(event)
        if options_response:
            return options_response
            
        http_method = event['httpMethod']
        logger.info(f"Processing {http_method} request")
        
        if http_method == 'GET':
            # Check if projectId is provided for single item retrieval
            path_parameters = event.get('pathParameters', {})
            if path_parameters and path_parameters.get('id'):
                return get_project(event)
            return list_projects(event)
        elif http_method == 'POST':
            return create_project(event)
        elif http_method == 'DELETE':
            return delete_project(event)
        
        logger.warning(f"Unsupported method: {http_method}")
        return create_response(event, 400, {'error': 'Unsupported method'})
    
    except ClientError as e:
        return handle_client_error(e, event)
    except Exception as e:
        return handle_general_exception(e, event, "ProjectsError")

@tracer.capture_method
def get_project(event):
    _, tenant_id = get_user_tenant_from_claims(event)
    if 'pathParameters' not in event or not event['pathParameters'] or 'id' not in event['pathParameters']:
        logger.warning("Project ID is missing in request")
        return create_response(event, 400, {'message': 'Project ID is required'})
    id = event['pathParameters']['id']
    
    logger.info(f"Getting project with ID: {id} for tenant: {tenant_id}")
    response = table.get_item(
        Key={
            'tenantId': tenant_id,
            'id': id
        }
    )
    
    item = response.get('Item')
    if not item:
        logger.warning(f"Project not found: {id}")
        metrics.add_metric(name="ProjectNotFound", unit="Count", value=1)
        return create_response(event, 404, {'error': 'Project not found'})
    
    metrics.add_metric(name="ProjectRetrieved", unit="Count", value=1)
    return create_response(event, 200, item)

@tracer.capture_method
def list_projects(event):
    _, tenant_id = get_user_tenant_from_claims(event)
    logger.info(f"Listing projects for tenant: {tenant_id}")
    
    response = table.query(
        KeyConditionExpression=Key('tenantId').eq(tenant_id)
    )
    
    logger.info(f"Found {len(response['Items'])} projects for tenant: {tenant_id}")
    metrics.add_metric(name="ProjectsListed", unit="Count", value=1)
    metrics.add_metric(name="ProjectsCount", unit="Count", value=len(response['Items']))
    return create_response(event, 200, response['Items'])

@tracer.capture_method
def create_project(event):
    user_id, tenant_id = get_user_tenant_from_claims(event)

    if not user_id or not tenant_id:
        logger.warning("User ID or Tenant ID is missing in request")
        return create_response(event, 400, {'message': 'User ID and Tenant ID are required'})

    body = json.loads(event['body'])
    
    timestamp = int(time.time())
    project_id = str(uuid.uuid4())
    item = {
        'userId': user_id,
        'id': project_id,
        'tenantId': tenant_id,
        'createdAt': timestamp,
        **body  # Include additional fields from the request body
    }
    
    logger.info(f"Creating new project with ID: {project_id} for user: {user_id} for tenant: {tenant_id}")
    table.put_item(Item=item)
    
    metrics.add_metric(name="ProjectCreated", unit="Count", value=1)
    return create_response(event, 201, item)

@tracer.capture_method
def delete_s3_folder(bucket, prefix):
    # List all objects with the given prefix
    logger.info(f"Deleting S3 folder: {prefix} from bucket: {bucket}")
    paginator = s3.get_paginator('list_objects_v2')
    objects_to_delete = []
    
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        if 'Contents' in page:
            objects_to_delete.extend(
                [{'Key': obj['Key']} for obj in page['Contents']]
            )
    
    # If there are objects to delete
    if objects_to_delete:
        logger.info(f"Deleting {len(objects_to_delete)} objects from bucket: {bucket}")
        s3.delete_objects(
            Bucket=bucket,
            Delete={
                'Objects': objects_to_delete,
                'Quiet': True
            }
        )
        metrics.add_metric(name="S3ObjectsDeleted", unit="Count", value=len(objects_to_delete))
    else:
        logger.info(f"No objects found to delete in bucket: {bucket} with prefix: {prefix}")

@tracer.capture_method
def delete_project(event):
    if 'pathParameters' not in event or not event['pathParameters'] or 'id' not in event['pathParameters']:
        logger.warning("Project ID is missing in delete request")
        return create_response(event, 400, {'message': 'Project ID is required'})
    try:
        _, tenant_id = get_user_tenant_from_claims(event)
        project_id = event['pathParameters']['id']
        logger.info(f"Deleting project: {project_id} for tenant: {tenant_id}")
        
        # First, query for all files associated with this project
        logger.info(f"Querying for files associated with project: {project_id} and tenant: {tenant_id}")
        response = project_files_table.query(
            IndexName='tenantId-projectId-index',
            KeyConditionExpression=Key('tenantId').eq(tenant_id) & Key('projectId').eq(project_id)
        )
        items = response['Items']
        logger.info(f"Found {len(items)} files associated with project: {project_id} and tenant: {tenant_id}")

        # Get knowledge base ID and data source ID from environment variables
        knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
        data_source_id = os.environ.get('DATA_SOURCE_ID')
        
        # Delete items in batches of 25 (DynamoDB BatchWriteItem limit)
        with project_files_table.batch_writer() as batch:
            for item in items:
                # Delete document from knowledge base if knowledge base ID exists
                if knowledge_base_id:
                    try:
                        logger.info(f"Deleting document {item['id']} from knowledge base {knowledge_base_id}")
                        bedrock_agent.delete_knowledge_base_documents(
                            clientToken=str(uuid.uuid4()),
                            knowledgeBaseId=knowledge_base_id,
                            dataSourceId=data_source_id,
                            documentIdentifiers=[
                                {
                                    'custom': {
                                        'id': item['id']
                                    },
                                    'dataSourceType': 'CUSTOM'
                                }
                            ]
                        )
                        logger.info(f"Successfully deleted document {item['id']} from knowledge base")
                        metrics.add_metric(name="KnowledgeBaseDocumentDeleted", unit="Count", value=1)
                    except Exception as e:
                        logger.exception(f"Error deleting document from knowledge base: {str(e)}")
                        metrics.add_metric(name="KnowledgeBaseDocumentDeleteError", unit="Count", value=1)
                        # Continue with deletion even if knowledge base deletion fails
                
                batch.delete_item(
                    Key={
                        'tenantId': item['tenantId'], 
                        'id': item['id']
                    }
                )
        
        # Delete all objects in the project folder
        folder_prefix = tenant_id + '/' + project_id + '/'  # Note the trailing slash
        delete_s3_folder(os.environ['USER_FILES_BUCKET'], folder_prefix)

        # Finally, delete the project itself
        logger.info(f"Deleting project record from DynamoDB: {project_id}")
        table.delete_item(
            Key={
                'tenantId': tenant_id,
                'id': project_id
            }
        )
        
        metrics.add_metric(name="ProjectDeleted", unit="Count", value=1)
        return create_response(event, 204, '')
    except Exception as e:
        logger.exception(f"Error deleting project: {str(e)}")
        metrics.add_metric(name="DeleteProjectError", unit="Count", value=1)
        return create_response(event, 500, {'error': 'Failed to delete project'})