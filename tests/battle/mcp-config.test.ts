import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMcpConfig, writeMcpConfig } from '../../scripts/battle/lib/mcp-config';

describe('buildMcpConfig', () => {
  it('generates exactly one MCP server entry, hardcoded to the given url/token/entry point', () => {
    const config = buildMcpConfig({
      vikunjaUrl: 'http://localhost:33456/api/v1',
      vikunjaApiToken: 'tk_fake',
      distEntry: '/repo/dist/index.js',
    }) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };

    const servers = Object.keys(config.mcpServers);
    expect(servers).toEqual(['vikunja-battle']);
    const server = config.mcpServers['vikunja-battle']!;
    expect(server.args).toEqual(['/repo/dist/index.js']);
    expect(server.env).toEqual({ VIKUNJA_URL: 'http://localhost:33456/api/v1', VIKUNJA_API_TOKEN: 'tk_fake' });
  });

  it('honors a custom server name', () => {
    const config = buildMcpConfig({
      vikunjaUrl: 'http://localhost:33456/api/v1',
      vikunjaApiToken: 'tk_fake',
      distEntry: '/repo/dist/index.js',
      serverName: 'custom-name',
    }) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(config.mcpServers)).toEqual(['custom-name']);
  });
});

describe('writeMcpConfig', () => {
  it('writes valid JSON to disk, creating parent directories as needed', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'battle-mcp-config-test-'));
    const filePath = path.join(tmpDir, 'nested', 'mcp-config.json');

    writeMcpConfig(filePath, {
      vikunjaUrl: 'http://localhost:33456/api/v1',
      vikunjaApiToken: 'tk_fake',
      distEntry: '/repo/dist/index.js',
    });

    const written: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written).toMatchObject({ mcpServers: { 'vikunja-battle': { args: ['/repo/dist/index.js'] } } });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
