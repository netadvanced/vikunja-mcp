#!/usr/bin/env bash
# Generates a Docker MCP Toolkit catalog fragment for vikunja-mcp-ng and
# prints the exact `docker mcp` commands to register it locally.
#
# What this does NOT do: it does not silently write into your real
# ~/.docker/mcp/catalogs directory or set secrets for you. It prints the
# file and the commands; you run them (or don't) after reviewing them. See
# docs/DOCKER-DESKTOP-MCP.md for the full walkthrough and why this script
# exists (the official `docker mcp catalog create --server docker://<image>`
# path requires a "self-describing" image and rejects a plain
# Dockerfile-built image like this one's).
#
# Usage:
#   scripts/install-docker-desktop-mcp.sh [image] [vikunja-url]
#
#   image        Image reference to run (default: ghcr.io/netadvanced/vikunja-mcp-ng:latest)
#   vikunja-url  VIKUNJA_URL to bake into the catalog fragment (default: prompts you to edit it)

set -euo pipefail

IMAGE="${1:-ghcr.io/netadvanced/vikunja-mcp-ng:latest}"
VIKUNJA_URL="${2:-https://your-vikunja-instance.com/api/v1}"

CATALOG_NAME="vikunja-mcp-ng"
CATALOG_DIR="$HOME/.docker/mcp/catalogs"
CATALOG_FILE="$CATALOG_DIR/${CATALOG_NAME}.yaml"

echo "# --- Catalog fragment (would be written to $CATALOG_FILE) ---" >&2
cat <<EOF
registry:
  ${CATALOG_NAME}:
    description: MCP server for Vikunja task management (direct-REST, composite-first tools)
    title: Vikunja MCP NG
    type: server
    image: ${IMAGE}
    secrets:
      - name: ${CATALOG_NAME}.api_token
        env: VIKUNJA_API_TOKEN
        example: tk_xxx
        description: Vikunja API token (tk_...) or JWT (eyJ...)
    env:
      - name: VIKUNJA_URL
        value: ${VIKUNJA_URL}
EOF

cat <<EOF >&2

# --- Next steps (nothing above was written to disk) ---
# 1. Review the fragment above, then write it:
mkdir -p "$CATALOG_DIR"
cat > "$CATALOG_FILE" <<'CATALOG_EOF'
registry:
  ${CATALOG_NAME}:
    description: MCP server for Vikunja task management (direct-REST, composite-first tools)
    title: Vikunja MCP NG
    type: server
    image: ${IMAGE}
    secrets:
      - name: ${CATALOG_NAME}.api_token
        env: VIKUNJA_API_TOKEN
        example: tk_xxx
        description: Vikunja API token (tk_...) or JWT (eyJ...)
    env:
      - name: VIKUNJA_URL
        value: ${VIKUNJA_URL}
CATALOG_EOF

# 2. Store your token as a Docker Desktop secret (never in the catalog file):
echo "your-vikunja-api-token" | docker mcp secret set ${CATALOG_NAME}.api_token

# 3. Verify the gateway can see it (no network listener, just introspects):
docker mcp gateway run --catalog="$CATALOG_FILE" --servers=${CATALOG_NAME} --transport=stdio --dry-run

# 4. Point your MCP client at the gateway (see docs/DOCKER-DESKTOP-MCP.md for
#    per-client config), or run it ad hoc:
docker mcp gateway run --catalog="$CATALOG_FILE" --servers=${CATALOG_NAME} --transport=stdio

# To remove everything this created later:
#   rm "$CATALOG_FILE"
#   docker mcp secret rm ${CATALOG_NAME}.api_token
EOF
