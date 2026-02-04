FROM node:20-alpine

# Install minimal dependencies for the CLI
RUN apk add --no-cache curl jq bc bash

# Set working directory
WORKDIR /app

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
