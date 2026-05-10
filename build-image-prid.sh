#!/bin/bash
set -euo pipefail

IMAGE_NAME="api-auth"
TAG="${1:-latest}"

echo "Building ${IMAGE_NAME}:${TAG}..."

docker build \
    --no-cache \
    -t "${IMAGE_NAME}:${TAG}" \
    .

echo "Done: ${IMAGE_NAME}:${TAG}"
