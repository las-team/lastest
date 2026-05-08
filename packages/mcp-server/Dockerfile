FROM node:20-alpine

WORKDIR /app

RUN npm install -g @lastest/mcp-server@latest

ENV LASTEST_URL=https://app.lastest.cloud
ENV LASTEST_API_KEY=introspection-only
ENV LASTEST_SKIP_HEALTH_CHECK=1

ENTRYPOINT ["sh","-c","exec lastest-mcp --url \"$LASTEST_URL\" --api-key \"$LASTEST_API_KEY\""]
