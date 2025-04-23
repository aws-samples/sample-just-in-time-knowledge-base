import json
import os
import uuid
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError

# Import common utilities
from common_utils import (
    logger, tracer, metrics, bedrock_agent,
    handle_client_error, handle_general_exception
)

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def lambda_handler(event, context: LambdaContext):
    """
    This function is triggered by DynamoDB Streams when TTL expires items.
    It removes expired documents from the knowledge base.
    """
    logger.info(f"Received event with {len(event.get('Records', []))} records")
    
    try:
        # Get the knowledge base ID from environment variables
        knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
        if not knowledge_base_id:
            logger.error("Knowledge base ID not configured")
            metrics.add_metric(name="MissingKnowledgeBaseId", unit="Count", value=1)
            return {
                'statusCode': 500,
                'error': 'Knowledge base ID not configured'
            }

        data_source_id = os.environ.get('DATA_SOURCE_ID')
        if not data_source_id:
            logger.error("Data source ID not configured")
            metrics.add_metric(name="MissingDataSourceId", unit="Count", value=1)
            return {
                'statusCode': 500,
                'error': 'Data source ID not configured'
            }
        
        # Get the DynamoDB table name from environment variables
        kb_files_table_name = os.environ.get('KNOWLEDGE_BASE_FILES_TABLE')
        if not kb_files_table_name:
            logger.error("Knowledge base files table name not configured")
            metrics.add_metric(name="MissingTableName", unit="Count", value=1)
            return {
                'statusCode': 500,
                'error': 'Knowledge base files table name not configured'
            }
        
        # if the length of the records is 0 then log an message about empty record set
        if len(event.get('Records', [])) == 0:
            logger.info("No records to process")
            return {
                'statusCode': 200,
                'message': "No records to process"
            }

        processed_count = 0
        error_count = 0

        # Process each record in the event
        for record in event.get('Records', []):
            # Check if this is a TTL expiration event (REMOVE event from DynamoDB Stream)
            if record.get('eventName') == 'REMOVE':
                # Check if this is a TTL expiration (userIdentity.type is "Service" and principalId is "dynamodb.amazonaws.com")
                user_identity = record.get('userIdentity', {})
                if user_identity.get('type') == 'Service' and user_identity.get('principalId') == 'dynamodb.amazonaws.com':
                    # Extract the file ID and tenant ID from the record
                    old_image = record.get('dynamodb', {}).get('OldImage', {})
                    
                    # Get the keys from the record
                    keys = record.get('dynamodb', {}).get('Keys', {})
                    file_id = keys.get('id', {}).get('S')
                    tenant_id = keys.get('tenantId', {}).get('S')
                    
                    # Get additional metadata from the old image
                    project_id = old_image.get('projectId', {}).get('S') if 'projectId' in old_image else None
                    
                    if not file_id:
                        logger.warning(f"File ID not found in record")
                        continue
                    if not tenant_id:
                        logger.warning(f"Tenant ID not found in record")
                        continue
                    
                    logger.info(f"Processing expired file: {file_id}, tenant id: {tenant_id}, project id: {project_id}")
                    
                    # Delete the document from the knowledge base
                    try:
                        tracer.put_annotation(key="operation", value="delete_knowledge_base_documents")
                        bedrock_agent.delete_knowledge_base_documents(
                            clientToken=str(uuid.uuid4()),
                            knowledgeBaseId=knowledge_base_id,
                            dataSourceId=data_source_id,
                            documentIdentifiers=[
                                {
                                    'custom': {
                                        'id': file_id
                                    },
                                    'dataSourceType': 'CUSTOM'
                                }
                            ]
                        )
                        
                        logger.info(f"Deleted document {file_id} from knowledge base")
                        metrics.add_metric(name="DocumentDeleted", unit="Count", value=1)
                        processed_count += 1
                    
                    except ClientError as e:
                        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                        error_message = e.response.get('Error', {}).get('Message', str(e))
                        logger.error(f"Error deleting document {file_id} from knowledge base: {error_code} - {error_message}")
                        metrics.add_metric(name="DocumentDeleteError", unit="Count", value=1)
                        error_count += 1
                    except Exception as e:
                        logger.exception(f"Error deleting document {file_id} from knowledge base: {str(e)}")
                        metrics.add_metric(name="DocumentDeleteError", unit="Count", value=1)
                        error_count += 1
                else:
                    logger.info(f"Skipping non-TTL REMOVE event: {json.dumps(record)}")
            else:
                logger.info(f"Skipping non-REMOVE event: {record.get('eventName')}")
        
        metrics.add_metric(name="ProcessedRecords", unit="Count", value=processed_count)
        metrics.add_metric(name="ErrorRecords", unit="Count", value=error_count)
        
        return {
            'statusCode': 200,
            'message': f"Processed {processed_count} TTL expiration events with {error_count} errors"
        }
    
    except ClientError as e:
        logger.exception(f"AWS Client Error: {str(e)}")
        metrics.add_metric(name="AWSClientError", unit="Count", value=1)
        return {
            'statusCode': 500,
            'error': f"AWS Client Error: {str(e)}"
        }
    except Exception as e:
        logger.exception(f"Error processing TTL expiration events: {str(e)}")
        metrics.add_metric(name="ProcessingError", unit="Count", value=1)
        return {
            'statusCode': 500,
            'error': f"Error processing TTL expiration events: {str(e)}"
        }