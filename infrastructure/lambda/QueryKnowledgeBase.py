import json
import os
import uuid
import time
from typing import List, Dict
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError

# Import common utilities
from common_utils import (
    logger, tracer, metrics, dynamodb, bedrock_agent_runtime,
    create_response, handle_options_request, get_user_tenant_from_claims,
    get_file_ids, batch_delete_items, handle_client_error, handle_general_exception
)

@tracer.capture_method
def save_chat_message(session_id, user_id, tenant_id, project_id, message_type, content, timestamp, sources=None):
    """
    Save a chat message to the chat history table
    """
    chat_history_table = dynamodb.Table(os.environ['CHAT_HISTORY_TABLE'])
    
    # Create the item to save
    item = {
        'id': str(uuid.uuid4()),
        'sessionId': session_id,
        'tenantId': tenant_id,
        'userId': user_id,
        'projectId': project_id,
        'type': message_type,  # 'user', 'ai', 'system', 'error'
        'content': content,
        'timestamp': timestamp
    }
    
    # Add sources if provided
    if sources:
        item['sources'] = sources
    
    try:
        chat_history_table.put_item(Item=item)
        logger.info(f"Saved chat message for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Error saving chat message: {str(e)}")
        return False

@tracer.capture_method
def get_chat_history_by_tenant_user(tenant_id, user_id):
    """
    Retrieve chat history for a specific tenant and user
    """
    chat_history_table = dynamodb.Table(os.environ['CHAT_HISTORY_TABLE'])
    
    try:
        response = chat_history_table.query(
            IndexName='tenantId-userId-index',
            KeyConditionExpression=dynamodb.conditions.Key('tenantId').eq(tenant_id) & 
                                  dynamodb.conditions.Key('userId').eq(user_id),
            ScanIndexForward=True  # Sort by timestamp in ascending order
        )
        
        messages = response.get('Items', [])
        
        # Handle pagination if there are more results
        while 'LastEvaluatedKey' in response:
            response = chat_history_table.query(
                IndexName='tenantId-userId-index',
                KeyConditionExpression=dynamodb.conditions.Key('tenantId').eq(tenant_id) & 
                                      dynamodb.conditions.Key('userId').eq(user_id),
                ScanIndexForward=True, # Sort by timestamp in ascending order
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            messages.extend(response.get('Items', []))
        
        logger.info(f"Retrieved {len(messages)} messages for tenant ID: {tenant_id}, and user ID {user_id}")
        return messages
    except Exception as e:
        # Log as warning instead of error since we're handling the exception
        logger.warning(f"Error retrieving chat history: {str(e)}")
        return []

@tracer.capture_method
def delete_chat_session(tenant_id, project_id, user_id):
    try:
        # First, get all messages for this session
        messages = get_chat_history_by_tenant_user(tenant_id, user_id)
        
        # Use batch delete for better performance
        success = batch_delete_items(os.environ['CHAT_HISTORY_TABLE'], messages)
        
        if success:
            logger.info(f"Successfully batch deleted {len(messages)} messages for session {project_id}")
            return True
        else:
            logger.warning(f"Failed to batch delete messages for session {project_id}")
            return False
            
    except Exception as e:
        # Log as warning instead of error since we're handling the exception
        logger.warning(f"Error deleting chat session: {str(e)}")
        return False

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def handler(event, context: LambdaContext):
    try:
        # Check if this is a preflight OPTIONS request
        options_response = handle_options_request(event)
        if options_response:
            return options_response
        
        # Get the user ID from the Cognito authorizer
        user_id, tenant_id = get_user_tenant_from_claims(event)
        
        if not user_id or not tenant_id:
            logger.warning("User ID or Tenant ID is missing in request")
            metrics.add_metric(name="MissingUserId", unit="Count", value=1)
            return create_response(event, 400, {'error': 'User ID and Tenant ID is required'})
        
        # Get the path and method to determine the operation
        path = event.get('path', '')
        http_method = event.get('httpMethod', '')
        
        # Handle different API endpoints
        if path.endswith('/knowledge-base/query') and http_method == 'POST':
            return handle_query(event, user_id, tenant_id)
        elif '/knowledge-base/history/' in path and http_method == 'GET':
            project_id = event['pathParameters']['id']
            return handle_get_session(event, user_id, tenant_id, project_id)
        elif '/knowledge-base/history/' in path and http_method == 'DELETE':
            project_id = event['pathParameters']['id']
            return handle_delete_session(event, user_id, tenant_id, project_id)
        else:
            logger.warning(f"Unsupported path or method: {path}, {http_method}")
            return create_response(event, 400, {'error': 'Unsupported operation'})
            
    except ClientError as e:
        return handle_client_error(e, event)
    except Exception as e:
        return handle_general_exception(e, event, "ProcessingError")

@tracer.capture_method
def update_chat_history_session_id(user_id, tenant_id, results_id, old_session_id, new_session_id):
    """
    Update all chat history items for a results_id with a new session_id
    """
    try:
        chat_history_table = dynamodb.Table(os.environ['CHAT_HISTORY_TABLE'])
        
        # Get all messages for this results_id
        messages = get_chat_history_by_tenant_user(tenant_id, user_id)
        
        # Filter messages by the old session ID
        messages_to_update = [msg for msg in messages if msg.get('sessionId') == old_session_id]
        
        if not messages_to_update:
            logger.info(f"No messages found with session ID {old_session_id} to update")
            return True
        
        # Update each message with the new session ID
        with chat_history_table.batch_writer() as batch:
            for msg in messages_to_update:
                # Create a new item with the updated session ID
                updated_item = msg.copy()
                updated_item['sessionId'] = new_session_id
                
                # Write the updated item
                batch.put_item(Item=updated_item)
        
        logger.info(f"Updated {len(messages_to_update)} messages with new session ID {new_session_id}")
        return True
    except Exception as e:
        # Log as warning instead of error since we're handling the exception
        logger.warning(f"Error updating chat history session IDs: {str(e)}")
        return False

@tracer.capture_method
def perform_retrieve_and_generate(retrieve_params):
    """
    Perform the retrieve_and_generate call with error handling for invalid session IDs
    """
    try:
        # First attempt with the provided session ID (if any)
        logger.info("Attempting retrieve_and_generate with provided parameters")
        response = bedrock_agent_runtime.retrieve_and_generate(**retrieve_params)
        return response, False  # No session ID change
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', '')
        
        # Check if this is an invalid session ID error
        if (error_code == 'ValidationException' and 
            'is not valid' in error_message and 
            'Session with Id' in error_message):
            
            logger.warning(f"Invalid session ID error: {error_message}. Retrying without session ID.")
            
            # Remove the session ID and try again
            if 'sessionId' in retrieve_params:
                old_session_id = retrieve_params.pop('sessionId')
                logger.info(f"Removed invalid session ID: {old_session_id}")
                
                # Retry without the session ID
                response = bedrock_agent_runtime.retrieve_and_generate(**retrieve_params)
                return response, True  # Session ID was changed
            else:
                # This shouldn't happen, but just in case
                logger.warning("Invalid session ID error but no sessionId in parameters")
                raise
        else:
            # For other errors, just re-raise
            logger.warning(f"Error in retrieve_and_generate: {error_code} - {error_message}")
            raise

@tracer.capture_method
def handle_query(event, user_id, tenant_id):
    """
    Handle POST /knowledge-base/query endpoint
    """
    # Parse the request body
    body = json.loads(event.get('body', '{}'))
    
    # Get the query text from the request
    query = body.get('query')
    if not query:
        logger.warning("Missing query text in request")
        metrics.add_metric(name="MissingQueryError", unit="Count", value=1)
        return create_response(event, 400, {'error': 'Query text is required'})
    
    query_params = event.get('queryStringParameters', {}) or {}
    
    project_id = query_params.get('projectId') or body.get('projectId')
    session_id = query_params.get('sessionId') or body.get('sessionId')
    limit = 5
    
    # Get the knowledge base ID from environment variables
    knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
    if not knowledge_base_id:
        logger.warning("Knowledge base ID not configured")
        metrics.add_metric(name="MissingKnowledgeBaseId", unit="Count", value=1)
        return create_response(event, 500, {'error': 'Knowledge base ID not configured'})
    
    if not project_id:
        logger.warning("Project ID is missing in request")
        metrics.add_metric(name="MissingResultsId", unit="Count", value=1)
        return create_response(event, 400, {'error': 'Project ID is required'})
    
    logger.info(f"Processing knowledge base query: '{query}' for user: {user_id}, tenant: {tenant_id}, and project ID: {project_id}")
    
    # Get all file IDs for this project
    file_ids = get_file_ids(tenant_id, project_id)
    if not file_ids:
        logger.warning(f"No files found for project ID: {project_id}")
        metrics.add_metric(name="NoFilesFound", unit="Count", value=1)
        return create_response(event, 404, {'error': 'No files found for this project'})

    # log all file ids
    logger.info(f"File IDs for project ID: {project_id} and tenant id: {tenant_id}: {file_ids}")
    # Create filter expression for the specified file IDs
    filter_expression = {
        "andAll": [
            {
                "equals": {
                    "key": "tenantId",
                    "value": tenant_id
                }
            },
            {
                "equals": {
                    "key": "projectId",
                    "value": project_id
                }
            },
            {
                "in": {
                    "key": "fileId",
                    "value": file_ids
                }
            }
        ]
    }

    # Create base parameters for the API call
    retrieve_params = {
        'input': {
            'text': query
        },
        'retrieveAndGenerateConfiguration': {
            'type': 'KNOWLEDGE_BASE',
            'knowledgeBaseConfiguration': {
                'knowledgeBaseId': knowledge_base_id,
                'modelArn': 'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0',
                'retrievalConfiguration': {
                    'vectorSearchConfiguration': {
                        'numberOfResults': limit,
                        'filter': filter_expression
                    }
                }
            }
        }
    }
    
    # Add sessionId parameter only if it's provided and not empty
    if session_id and isinstance(session_id, str) and session_id.strip():
        retrieve_params['sessionId'] = session_id
        logger.debug(f"Using session ID: {session_id}")
    
    # Query the knowledge base using retrieve_and_generate with error handling
    logger.info(f"Querying knowledge base: {knowledge_base_id}")
    tracer.put_annotation(key="operation", value="retrieve_and_generate")
    
    try:
        response, session_changed = perform_retrieve_and_generate(retrieve_params)
        
        # If the session ID was changed (invalid session error handled), update chat history
        if session_changed and session_id:
            new_session_id = response.get('sessionId')
            logger.info(f"Session ID changed from {session_id} to {new_session_id}")
            
            # Update all chat history items with the new session ID
            update_success = update_chat_history_session_id(user_id, tenant_id, project_id, session_id, new_session_id)
            if not update_success:
                logger.warning(f"Failed to update chat history with new session ID {new_session_id}")
    except Exception as e:
        # Log as warning instead of error since we're handling the exception
        logger.warning(f"Error querying knowledge base: {str(e)}")
        metrics.add_metric(name="KnowledgeBaseQueryError", unit="Count", value=1)
        return create_response(event, 500, {'error': f"Error querying knowledge base: {str(e)}"})
    
    # Extract sources from citations if available
    sources = []
    if response.get('citations'):
        for citation in response.get('citations', []):
            for reference in citation.get('retrievedReferences', []):
                # Extract metadata
                metadata = reference.get('metadata', {})
                file_id = metadata.get('fileId', '')
                
                source = {
                    'fileId': file_id,
                    'content': reference.get('content', {}).get('text', ''),
                    'metadata': metadata
                }
                sources.append(source)
        
    logger.info("Knowledge base query successful")
    metrics.add_metric(name="SuccessfulQuery", unit="Count", value=1)
    
    # Add session ID to the response
    session_id = response['sessionId']
    timestamp = int(time.time())
    
    # Save user message
    save_chat_message(
        session_id=session_id,
        user_id=user_id,
        tenant_id=tenant_id,
        project_id=project_id,
        message_type='user',
        content=query,
        timestamp=timestamp
    )

    # Save AI response
    save_chat_message(
        session_id=session_id,
        user_id=user_id,
        tenant_id=tenant_id,
        project_id=project_id,
        message_type='ai',
        content=response.get('output', {}).get('text', ''),
        sources=sources,
        timestamp=timestamp+1
    )

    return create_response(event, 200, {
        'query': query,
        'results': response,
        'filters': {
            'fileIds': file_ids,
            'projectId': project_id,
            'tenantId': tenant_id,
            'userId': user_id
        }
    })

@tracer.capture_method
def handle_get_session(event, user_id, tenant_id, project_id):
    """
    Handle GET /knowledge-base/history/{id} endpoint
    """
    if not project_id:
        logger.warning("Project ID is missing in request")
        return create_response(event, 400, {'error': 'Project ID is required'})
    
    # Get chat history for this session
    messages = get_chat_history_by_tenant_user(tenant_id, user_id)
    
    # Check if any messages belong to this user
    if not messages:
        logger.warning(f"No messages found for project ID: {project_id}, tenant ID: {tenant_id}, user ID: {user_id}")
        return create_response(event, 200, {'messages': [], 'count': 0 })

    return create_response(event, 200, {
        'messages': messages,
        'count': len(messages)
    })

@tracer.capture_method
def handle_delete_session(event, user_id, tenant_id, project_id):
    """
    Handle DELETE /knowledge-base/history/{id} endpoint
    """
    if not project_id:
        logger.warning("Project ID is missing in request")
        return create_response(event, 400, {'error': 'Project ID is required'})
    
    # Delete the chat session
    success = delete_chat_session(tenant_id, project_id, user_id)
    
    if not success:
        return create_response(event, 404, {'error': 'Project chat history not found or not authorized'})
    
    return create_response(event, 200, {
        'message': f'Project {project_id} chat history deleted successfully'
    })