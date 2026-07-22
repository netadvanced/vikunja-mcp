# syntax=docker/dockerfile:1

# vikunja-mcp-ng — Model Context Protocol server for Vikunja
#
# Multi-stage build: compile TypeScript in a full node image, then ship only
# the compiled dist/ plus production dependencies in a slim, non-root
# runtime image. The server speaks MCP over stdio (see src/index.ts) — run
# it with `docker run -i`, not as a long-lived network service.
#
# Build:
#   docker build -t ghcr.io/netadvanced/vikunja-mcp-ng:dev .
#
# Run (stdio transport — pipe JSON-RPC in/out):
#   docker run -i --rm \
#     -e VIKUNJA_URL=https://vikunja.example.com/api/v1 \
#     -e VIKUNJA_API_TOKEN=tk_xxx \
#     ghcr.io/netadvanced/vikunja-mcp-ng:dev
#
# See docs/CONFIGURATION.md for VIKUNJA_MCP_CONFIG / VIKUNJA_API_TOKEN_FILE
# and docker-compose.example.yml for a mounted-config example.

# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Install full dependency graph (including devDependencies) for the build.
# --ignore-scripts: package.json's "prepare" script runs `npm run build`
# itself, which would fire here (before `src/` is even copied in) and fail —
# we invoke the real build explicitly below once the sources are present.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune devDependencies out of node_modules for the runtime stage, keeping
# this a single npm ci + npm run build + npm prune sequence (no second
# resolve pass, no risk of the runtime install drifting from the lockfile).
RUN npm prune --omit=dev --ignore-scripts

# ---- runtime stage ----------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

# Run as a dedicated non-root user rather than the image's default `node`
# user id, so it's predictable across base-image versions.
RUN addgroup -S vikunja-mcp && adduser -S vikunja-mcp -G vikunja-mcp

WORKDIR /app

COPY --from=build --chown=vikunja-mcp:vikunja-mcp /app/package.json ./package.json
COPY --from=build --chown=vikunja-mcp:vikunja-mcp /app/node_modules ./node_modules
COPY --from=build --chown=vikunja-mcp:vikunja-mcp /app/dist ./dist

USER vikunja-mcp

# No EXPOSE — this is a stdio MCP server, not a network listener.
# VIKUNJA_URL / VIKUNJA_API_TOKEN (or VIKUNJA_API_TOKEN_FILE) and
# VIKUNJA_MCP_CONFIG are supplied at `docker run` / compose time; see
# docs/CONFIGURATION.md.
ENTRYPOINT ["node", "dist/index.js"]
