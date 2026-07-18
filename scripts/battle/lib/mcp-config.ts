/**
 * Generates the `--mcp-config` JSON file handed to headless `claude -p`
 * runs. The generated config exposes exactly one MCP server -- this repo's
 * own build (`node dist/index.js`) -- hardcoded to the disposable local e2e
 * stack's URL and a freshly-minted credential. Combined with the runner's
 * `--strict-mcp-config` flag (which makes Claude Code ignore every other
 * configured MCP server: user-global config, project `.mcp.json`, etc.),
 * this is the *entire* tool surface available to the agent under test.
 *
 * SAFETY: `vikunjaUrl` must already have passed `assertLocalUrl` (see
 * scripts/battle/lib/config.ts) before this is called -- this module does
 * not re-validate it, so callers must not skip that step.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface McpConfigOptions {
  vikunjaUrl: string;
  vikunjaApiToken: string;
  distEntry: string;
  /** Server key as it will appear in tool names, e.g. "vikunja-battle" -> "mcp__vikunja-battle__vikunja_tasks". */
  serverName?: string;
}

export function buildMcpConfig(opts: McpConfigOptions): object {
  const serverName = opts.serverName ?? 'vikunja-battle';
  return {
    mcpServers: {
      [serverName]: {
        command: process.execPath,
        args: [opts.distEntry],
        env: {
          VIKUNJA_URL: opts.vikunjaUrl,
          VIKUNJA_API_TOKEN: opts.vikunjaApiToken,
        },
      },
    },
  };
}

/** Writes the generated config to `filePath` (creating parent dirs) and returns the server name it registered. */
export function writeMcpConfig(filePath: string, opts: McpConfigOptions): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const config = buildMcpConfig(opts);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  return opts.serverName ?? 'vikunja-battle';
}
