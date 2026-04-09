#!/bin/bash
# Checks for an updated Docker image in GHCR and redeploys the dokku app if a new image is found.
# Intended to be run as a cron job (e.g. every minute via: * * * * * /path/to/deploy-from-ghcr.sh)
set -euo pipefail

IMAGE="ghcr.io/communitytechaid/techaid-dashboard:latest"
APP="app"
LOCKFILE="/tmp/techaid-dashboard-deploy.lock"

# Prevent concurrent runs
exec 9>"$LOCKFILE"
flock -n 9 || exit 0

# Record digest before pull
OLD_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "")

# Pull latest image from GHCR
if ! docker pull "$IMAGE" > /dev/null 2>&1; then
    echo "$(date): Failed to pull $IMAGE" >&2
    exit 1
fi

# Record digest after pull
NEW_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "")

# Only redeploy if the image actually changed
if [ "$OLD_DIGEST" != "$NEW_DIGEST" ]; then
    echo "$(date): New image detected ($NEW_DIGEST), deploying to dokku app: $APP"
    dokku git:from-image "$APP" "$NEW_DIGEST"
fi
