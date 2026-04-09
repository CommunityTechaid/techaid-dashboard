#!/bin/sh
# Generates assets/env.js at container startup so runtime env vars are available to the Angular app.
# Values set here override the build-time defaults from environment.ts files.
cat > /usr/share/nginx/html/assets/env.js << EOF
window.__env = window.__env || {};
window.__env.appInsightsConnectionString = "${APPLICATIONINSIGHTS_CONNECTION_STRING}";
window.__env.graphql_endpoint = "${GRAPHQL_ENDPOINT}";
EOF
