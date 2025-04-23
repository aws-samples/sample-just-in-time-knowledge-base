#!/bin/bash
set -e

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
LAYERS_ZIP_DIR="$SCRIPT_DIR/../../../lambda/layers-zip"

# Create the layers-zip directory if it doesn't exist
mkdir -p "$LAYERS_ZIP_DIR"

# Define the zip file path
ZIP_FILE="$LAYERS_ZIP_DIR/sample-just-in-time-layer.zip"

# Check if the zip file already exists and if we should rebuild
if [ -f "$ZIP_FILE" ] && [ "$1" != "--force" ]; then
  echo "Boto3 layer zip already exists at $ZIP_FILE"
  echo "Use --force to rebuild the layer"
  exit 0
fi

echo "Building boto3 layer using Docker with Python 3.12 compatibility..."

# Create a Dockerfile for building the layer
cat > "$SCRIPT_DIR/Dockerfile" << EOF
FROM amazon/aws-lambda-python:3.12

# Copy requirements file
COPY requirements.txt /tmp/

# Install dependencies directly in the /opt/python directory (Lambda layer structure)
RUN pip install --upgrade pip && \\
    pip install -r /tmp/requirements.txt -t /opt/python && \\
    chmod -R 755 /opt/python/

# List contents to verify
RUN ls -la /opt/python/
EOF

# Build the Docker image
echo "Building Docker image..."
docker build -t boto3-layer-builder "$SCRIPT_DIR"

# Run the container and extract the layer contents
echo "Extracting layer contents from container..."
rm -rf "$SCRIPT_DIR/python"
mkdir -p "$SCRIPT_DIR/python"

# Create a container that we can copy files from
CONTAINER_ID=$(docker create boto3-layer-builder)

# Copy the files from the container to the local filesystem
echo "Copying files from container $CONTAINER_ID..."
docker cp "$CONTAINER_ID:/opt/python/." "$SCRIPT_DIR/python/"

# Remove the temporary container
docker rm "$CONTAINER_ID"

# Clean up the Dockerfile
echo "Cleaning up..."
rm "$SCRIPT_DIR/Dockerfile"

# Verify the files were copied correctly
if [ -d "$SCRIPT_DIR/python/boto3" ]; then
  echo "Boto3 layer built successfully with Python 3.12 compatibility"
  echo "Contents of python directory:"
  ls -la "$SCRIPT_DIR/python/" | head -10
  
  # Create the zip file
  echo "Creating zip file at $ZIP_FILE..."
  cd "$SCRIPT_DIR"
  zip -r "$ZIP_FILE" python/
  
  # Add version information to the zip
  echo "boto3 layer built on $(date)" > version.txt
  echo "Requirements:" >> version.txt
  cat requirements.txt >> version.txt
  zip -u "$ZIP_FILE" version.txt
  rm version.txt
  
  echo "Boto3 layer zip created successfully at $ZIP_FILE"
else
  echo "ERROR: Failed to build boto3 layer - python directory is empty or missing boto3"
  echo "Contents of python directory (if any):"
  ls -la "$SCRIPT_DIR/python/"
  exit 1
fi
