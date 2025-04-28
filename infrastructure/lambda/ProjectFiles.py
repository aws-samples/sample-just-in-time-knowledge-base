# lambda/ProjectFiles.py
import json
import os
import urllib.parse
import uuid
import time
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from aws_lambda_powertools.utilities.typing import LambdaContext

# Import common utilities
from common_utils import (
    logger, tracer, metrics, dynamodb, s3, bedrock_agent,
    create_response, handle_options_request, get_user_tenant_from_claims,
    handle_client_error, handle_general_exception
)

# Initialize DynamoDB table
table = dynamodb.Table(os.environ['PROJECT_FILES_TABLE'])

# Load tenant configuration
tenants = json.loads(os.environ.get('TENANTS', '{"Tenants":[]}'))['Tenants']

@tracer.capture_method  
def find_tenant(tenant_id, tenants):
    try:
        return next(tenant for tenant in tenants if tenant['Id'] == tenant_id)
    except StopIteration:
        return None

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
            path_parameters = event.get('pathParameters', {})
            # Check if this is a request for a single file
            if 'id' in path_parameters:
                return get_project_file(event)
            # Check if this is a request for files by project ID
            elif 'projectId' in path_parameters:
                return list_project_files_by_project_id(event)
            # Check if this is a request to download a file
            elif 'downloadId' in path_parameters:
                return handle_download_request(event)
            logger.warning("Missing required parameters in request")
            return create_response(event, 400, {'error': 'Missing required parameters'})
        elif http_method == 'POST':
            return handle_file_upload(event)
        elif http_method == 'DELETE':
            return delete_project_file(event)
        
        logger.warning(f"Unsupported method: {http_method}")
        return create_response(event, 400, {'error': 'Unsupported method'})
    
    except ClientError as e:
        return handle_client_error(e, event)
    except Exception as e:
        return handle_general_exception(e, event, "ProjectFilesError")

@tracer.capture_method
def get_project_file(event):
    try:
        user_id, tenant_id = get_user_tenant_from_claims(event)
        if 'pathParameters' not in event or not event['pathParameters'] or 'id' not in event['pathParameters']:
            logger.warning("Project file ID is missing in request")
            return create_response(event, 400, {'message': 'Project file ID is required'})
        
        # URL decode the ID parameter
        id = urllib.parse.unquote(event['pathParameters']['id'])
        logger.info(f"Getting project file with ID: {id} for tenant id: {tenant_id}")
        
        response = table.get_item(
            Key={
                'tenantId': tenant_id,
                'id': id
            }
        )
        
        item = response.get('Item')
        if not item:
            logger.warning(f"Project file not found: {id}")
            metrics.add_metric(name="ProjectFileNotFound", unit="Count", value=1)
            return create_response(event, 404, {'error': 'Project file not found'})
        
        metrics.add_metric(name="ProjectFileRetrieved", unit="Count", value=1)
        return create_response(event, 200, item)
    except Exception as e:
        logger.exception(f"Error getting project file: {str(e)}")
        metrics.add_metric(name="GetProjectFileError", unit="Count", value=1)
        return create_response(event, 500, {'error': 'Failed to retrieve project file'})

@tracer.capture_method
def list_project_files_by_project_id(event):
    user_id, tenant_id = get_user_tenant_from_claims(event)
    if 'pathParameters' not in event or not event['pathParameters'] or 'projectId' not in event['pathParameters']:
        logger.warning("Project ID is missing in request")
        return create_response(event, 400, {'message': 'Project ID is required'})
    
    # URL decode the projectId parameter
    project_id = urllib.parse.unquote(event['pathParameters']['projectId'])
    logger.info(f"Listing project files for project ID: {project_id}")
    
    try:
        response = table.query(
            IndexName='tenantId-projectId-index',
            KeyConditionExpression=Key('tenantId').eq(tenant_id) & Key('projectId').eq(project_id)
        )
        
        items = response.get('Items', [])
        
        logger.info(f"Found {len(items)} project files for project ID: {project_id}")
        metrics.add_metric(name="ProjectFilesListed", unit="Count", value=1)
        metrics.add_metric(name="ProjectFilesCount", unit="Count", value=len(items))
        return create_response(event, 200, items)
        
    except Exception as e:
        logger.exception(f"Error querying project files: {str(e)}")
        metrics.add_metric(name="ListProjectFilesError", unit="Count", value=1)
        return create_response(event, 500, {'error': 'Failed to retrieve project files'})

@tracer.capture_method
def create_upload_presigned_url(file_id, s3_key):
    try:
        # Generate presigned URL for upload
        response = s3.generate_presigned_url('put_object',
            Params={
                'Bucket': os.environ['USER_FILES_BUCKET'],
                'Key': s3_key,
                'ContentType': 'application/octet-stream'
            },
            ExpiresIn=3600,  # URL expires in 1 hour
            HttpMethod='PUT'
        )
        
        logger.info(f"Generated presigned URL for file: {s3_key}")
        metrics.add_metric(name="PresignedUrlGenerated", unit="Count", value=1)
        
        return {
            'uploadUrl': response,
            'fileId': file_id
        }
        
    except ClientError as e:
        logger.exception(f"Error generating presigned URL: {str(e)}")
        metrics.add_metric(name="PresignedUrlError", unit="Count", value=1)
        return None

@tracer.capture_method  
def create_file_record(user_id, tenant_id, project_id, file_name, file_size, s3_key):
    """
    Creates a new file record in DynamoDB
    """
    try:
        # Generate a unique ID for the file
        file_id = str(uuid.uuid4())
        
        # Get current timestamp in seconds since epoch
        current_time = int(time.time())
        
        # Create the item
        item = {
            'id': file_id,
            'userId': user_id,
            'tenantId': tenant_id,
            'projectId': project_id,
            'createdAt': current_time,
            'filesize': file_size,
            'filename': file_name,
            's3Key': s3_key,
            'bucket': os.environ['USER_FILES_BUCKET']
        }
        
        # Put the item in DynamoDB
        table.put_item(Item=item)
        
        logger.info(f"Created file record with ID: {file_id}")
        metrics.add_metric(name="FileRecordCreated", unit="Count", value=1)
        
        return file_id
        
    except Exception as e:
        logger.warning(f"Error creating file record: {str(e)}")
        metrics.add_metric(name="FileRecordCreationError", unit="Count", value=1)
        raise

@tracer.capture_method
def handle_file_upload(event):
    try:
        user_id, tenant_id = get_user_tenant_from_claims(event)
        
        if not user_id or not tenant_id:
            logger.warning("User ID or Tenant ID is missing in request")
            return create_response(event, 400, {'message': 'User ID and Tenant ID are required'})
        
        body = json.loads(event['body'])
        file_name = body.get('filename')
        file_size = body.get('filesize')
        if 'pathParameters' not in event or not event['pathParameters'] or 'projectId' not in event['pathParameters']:
            logger.warning("Project ID is missing in request")
            return create_response(event, 400, {'message': 'Project ID is required'})
        
        # URL decode the projectId parameter
        project_id = urllib.parse.unquote(event['pathParameters']['projectId'])

        logger.info(f"Processing upload request for file: {file_name}, projectId: {project_id}, userId: {user_id}, tenantId: {tenant_id}")
        
        if not file_name:
            logger.warning("Missing filename in request")
            return create_response(event, 400, {'error': 'file name is required'})
        
        if not file_size:
            logger.warning("Missing file size in request")
            return create_response(event, 400, {'error': 'file size is required'})
            
        # Check tenant file limit
        tenant = find_tenant(tenant_id, tenants)
        if not tenant:
            logger.warning(f"Tenant not found: {tenant_id}")
            return create_response(event, 400, {'error': 'Invalid tenant'})
            
        # Count existing files for this project
        response = table.query(
            IndexName='tenantId-projectId-index',
            KeyConditionExpression=Key('tenantId').eq(tenant_id) & Key('projectId').eq(project_id)
        )
        
        current_file_count = len(response.get('Items', []))
        max_files = tenant['MaxFiles']
        
        if current_file_count >= max_files:
            logger.warning(f"File limit exceeded for tenant {tenant_id}. Current: {current_file_count}, Max: {max_files}")
            metrics.add_metric(name="TenantFileLimitExceeded", unit="Count", value=1)
            return create_response(event, 400, {
                'error': f'File limit exceeded. Maximum {max_files} files allowed per project.'
            })
            
        s3_key = f"{tenant_id}/{project_id}/{file_name}"
        # Create the file record in DynamoDB
        file_id = create_file_record(user_id, tenant_id, project_id, file_name, file_size, s3_key)

        result = create_upload_presigned_url(file_id, s3_key)
        
        if not result:
            logger.error("Failed to generate upload URL")
            return create_response(event, 500, {'error': 'Failed to generate upload URL'})
        
        return create_response(event, 200, result)
    except Exception as e:
        logger.exception(f"Unexpected error: {str(e)}")
        return create_response(event, 500, {'error': f'Internal server error: {str(e)}'})

@tracer.capture_method
def delete_project_file(event):
    try:
        if 'pathParameters' not in event or not event['pathParameters'] or 'id' not in event['pathParameters']:
            logger.warning("Project file ID is missing in delete request")
            return create_response(event, 400, {'message': 'Project file ID is required'})
        
        user_id, tenant_id = get_user_tenant_from_claims(event)
        
        # URL decode the ID parameter
        id = urllib.parse.unquote(event['pathParameters']['id'])
        logger.info(f"Deleting project file with ID: {id} for user: {user_id}, tenantId: {tenant_id}")

        # First, get the item to retrieve the S3 key
        response = table.get_item(
            Key={
            'tenantId': tenant_id,
            'id': id
            }
        )
        
        item = response.get('Item')
        if not item:
            logger.warning(f"Project file not found for deletion: {id}")
            metrics.add_metric(name="DeleteProjectFileNotFound", unit="Count", value=1)
            return create_response(event, 404, {'error': 'Project file not found'})
            
        # Delete from S3 if the key exists
        if 's3Key' in item:
            try:
                logger.info(f"Deleting S3 object: {item['s3Key']}")
                s3.delete_object(
                    Bucket=os.environ['USER_FILES_BUCKET'],
                    Key=item['s3Key']
                )
            except Exception as e:
                logger.exception(f"Error deleting S3 object: {str(e)}")
                metrics.add_metric(name="DeleteS3Error", unit="Count", value=1)
                return create_response(event, 500, {'error': 'Failed to delete file from S3'})
        
        # Delete document from knowledge base if it exists
        try:
            # Get knowledge base ID and data source ID from environment variables
            knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
            data_source_id = os.environ.get('DATA_SOURCE_ID')
            
            if knowledge_base_id and data_source_id:
                logger.info(f"Deleting document {id} from knowledge base {knowledge_base_id}")
                bedrock_agent.delete_knowledge_base_documents(
                    clientToken=str(uuid.uuid4()),
                    knowledgeBaseId=knowledge_base_id,
                    dataSourceId=data_source_id,
                    documentIdentifiers=[
                        {
                            'custom': {
                                'id': id
                            },
                            'dataSourceType': 'CUSTOM'
                        }
                    ]
                )
                logger.info(f"Successfully deleted document {id} from knowledge base")
            else:
                logger.warning("Knowledge base ID or data source ID not found in environment variables")
        except Exception as e:
            logger.exception(f"Error deleting document from knowledge base: {str(e)}")
            metrics.add_metric(name="DeleteKnowledgeBaseDocumentError", unit="Count", value=1)
            # Continue with deletion even if knowledge base deletion fails
            
        logger.info(f"Deleting project file record from DynamoDB: {id}")
        table.delete_item(
            Key={
                'tenantId': tenant_id,
                'id': id
            }
        )
        metrics.add_metric(name="ProjectFileDeleted", unit="Count", value=1)
        return create_response(event, 204, '')
    except Exception as e:
        logger.exception(f"Error deleting project file: {str(e)}")
        metrics.add_metric(name="DeleteProjectFileError", unit="Count", value=1)
        return create_response(event, 500, {'error': 'Failed to delete project file'})

@tracer.capture_method
def generate_presigned_url(bucket, key, filename=None, expiration=3600):
    try:
        params = {
            'Bucket': bucket,
            'Key': key
        }
        
        # Always add Content-Disposition header to force download
        # Use stronger attachment directive with quoted filename
        if filename:
            # URL encode special characters in the filename
            import urllib.parse
            encoded_filename = urllib.parse.quote(filename)
            params['ResponseContentDisposition'] = f'attachment; filename="{encoded_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            
            # For text files, explicitly set content type to binary to prevent browser display
            if filename.lower().endswith('.txt'):
                params['ResponseContentType'] = 'application/octet-stream'
        
        logger.debug(f"Generating presigned URL for bucket: {bucket}, key: {key}")
        response = s3.generate_presigned_url('get_object',
            Params=params,
            ExpiresIn=expiration
        )
        metrics.add_metric(name="PresignedUrlGenerated", unit="Count", value=1)
        return response
    except Exception as e:
        logger.warning(f"Error generating presigned URL: {e}")
        metrics.add_metric(name="PresignedUrlError", unit="Count", value=1)
        raise

@tracer.capture_method
def handle_download_request(event):
    try:
        user_id, tenant_id = get_user_tenant_from_claims(event)
        if 'pathParameters' not in event or not event['pathParameters'] or 'downloadId' not in event['pathParameters']:
            logger.warning("Download ID is missing in request")
            return create_response(event, 400, {'message': 'Project file Id (downloadId) is required'})
        
        # URL decode the downloadId parameter
        id = urllib.parse.unquote(event['pathParameters']['downloadId'])
        logger.info(f"Handling download request for file ID: {id}")

        response = table.get_item(
            Key={
                'tenantId': tenant_id,
                'id': id
            }
        )
        
        item = response.get('Item')
        if not item:
            logger.warning(f"Project file not found for download: {id}")
            metrics.add_metric(name="DownloadFileNotFound", unit="Count", value=1)
            return create_response(event, 404, {'error': 'Project file not found'})

        # Use original file
        bucket = item['bucket']
        key = item['s3Key']
        filename = item['filename']
        logger.info(f"Generating download URL for original file: {filename}")

        # Generate presigned URL with Content-Disposition header to force download
        download_url = generate_presigned_url(bucket, key, filename)
        
        if not download_url:
            logger.error("Failed to generate download URL")
            return create_response(event, 500, {'error': 'Failed to generate download URL'})
        
        metrics.add_metric(name="DownloadUrlGenerated", unit="Count", value=1)
        return create_response(event, 200, {'downloadUrl': download_url})

    except Exception as e:
        logger.exception(f"Error handling download request: {e}")
        metrics.add_metric(name="DownloadRequestError", unit="Count", value=1)
        return create_response(event, 500, {'error': 'Failed to generate download request'})