import json
import os
from decimal import Decimal
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key
from typing import List, Dict, Optional, Tuple, Any
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.utilities.typing import LambdaContext

# Initialize powertools
logger = Logger()
tracer = Tracer()
metrics = Metrics()

# Initialize AWS clients
from boto3 import resource, client  # Import specific functions from boto3
dynamodb = resource('dynamodb')
s3 = client('s3')
bedrock_agent = client('bedrock-agent')
bedrock_agent_runtime = client('bedrock-agent-runtime')
class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types by converting them to float."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)  # Convert Decimal to float
        return super(DecimalEncoder, self).default(obj)

def get_cors_headers(event):
    """
    Get CORS headers for API responses.
    
    Args:
        event: The Lambda event object
        
    Returns:
        dict: CORS headers
    """
    # Get origin from the request headers
    origin = event.get('headers', {}).get('origin') or event.get('headers', {}).get('Origin')
    
    # For credentialed requests, we must specify the exact origin
    access_control_origin = origin if origin else 'http://localhost:8000'
    
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Headers': os.environ.get('ALLOWED_HEADERS', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'),
        'Access-Control-Allow-Methods': 'GET, OPTIONS, POST, PUT, DELETE',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Origin': access_control_origin
    }
    return headers

def create_response(event, status_code, body):
    """
    Create a standardized API response.
    
    Args:
        event: The Lambda event object
        status_code (int): HTTP status code
        body: Response body
        
    Returns:
        dict: API Gateway response object
    """
    return {
        'statusCode': status_code,
        'headers': get_cors_headers(event),
        'body': json.dumps(body, cls=DecimalEncoder)
    }

@tracer.capture_method
def handle_options_request(event):
    """
    Handle OPTIONS preflight requests.
    
    Args:
        event: The Lambda event object
        
    Returns:
        dict: API Gateway response for OPTIONS request or None
    """
    if event.get('httpMethod') == 'OPTIONS':
        return create_response(event, 200, {})
    return None

@tracer.capture_method
def get_user_tenant_from_claims(event):
    """
    Extract user_id and tenant_id from Cognito claims.
    
    Args:
        event: The Lambda event object
        
    Returns:
        tuple: (user_id, tenant_id)
    """
    claims = event['requestContext']['authorizer']['claims']
    user_id = claims['sub']
    tenant_id = claims['custom:tenantId']
    return user_id, tenant_id

@tracer.capture_method
def query_items_by_tenant_project(table_name, tenant_id, project_id):
    """
    Query items by tenant ID and project ID using the GSI.
    
    Args:
        table_name (str): DynamoDB table name
        tenant_id (str): Tenant ID
        project_id (str): Project ID
        
    Returns:
        list: Items matching the query
    """
    table = dynamodb.Table(table_name)
    response = table.query(
        IndexName='tenantId-projectId-index',
        KeyConditionExpression=Key('tenantId').eq(tenant_id) & Key('projectId').eq(project_id)
    )
    return response.get('Items', [])

@tracer.capture_method
def get_file_ids(tenant_id, project_id):
    """
    Query the project files table to get all file IDs associated with a project.
    
    Args:
        tenant_id (str): Tenant ID
        project_id (str): Project ID
        
    Returns:
        list: File IDs
    """
    project_files_table = dynamodb.Table(os.environ['PROJECT_FILES_TABLE'])
    
    logger.debug(f"Querying project files for tenant: {tenant_id}, and project ID: {project_id}")
    
    response = project_files_table.query(
        IndexName='tenantId-projectId-index',
        KeyConditionExpression=Key('tenantId').eq(tenant_id) & Key('projectId').eq(project_id)
    )

    file_ids = []
    for item in response.get('Items'):
        file_ids.append(item['id'])
    
    logger.info(f"Found {len(file_ids)} files for project ID: {project_id}")
    return file_ids

@tracer.capture_method
def batch_delete_items(table_name: str, items: List[Dict]) -> bool:
    """
    Delete multiple items from a DynamoDB table in batch.
    
    Args:
        table_name (str): DynamoDB table name
        items (List[Dict]): Items to delete
        
    Returns:
        bool: Success or failure
    """
    try:
        table = dynamodb.Table(table_name)
        with table.batch_writer() as batch:
            for item in items:
                batch.delete_item(
                    Key={
                        'tenantId': item['tenantId'],
                        'id': item['id']
                    }
                )
        return True
    except Exception as e:
        logger.warning(f"Error in batch delete: {str(e)}")
        return False

@tracer.capture_method
def handle_client_error(e: ClientError, event):
    """
    Handle AWS ClientError exceptions with standardized logging and response.
    
    Args:
        e (ClientError): The exception
        event: The Lambda event object
        
    Returns:
        dict: API Gateway response
    """
    error_code = e.response.get('Error', {}).get('Code', 'Unknown')
    error_message = e.response.get('Error', {}).get('Message', str(e))
    logger.error(f"AWS Client Error: {error_code} - {error_message}")
    metrics.add_metric(name="AWSClientError", unit="Count", value=1)
    return create_response(event, 500, {'error': 'Internal server error'})

@tracer.capture_method
def handle_general_exception(e: Exception, event, metric_name="ProcessingError"):
    """
    Handle general exceptions with standardized logging and response.
    
    Args:
        e (Exception): The exception
        event: The Lambda event object
        metric_name (str): Name for the metric
        
    Returns:
        dict: API Gateway response
    """
    logger.exception(f"Error: {str(e)}")
    metrics.add_metric(name=metric_name, unit="Count", value=1)
    return create_response(event, 500, {'error': 'Internal server error'})