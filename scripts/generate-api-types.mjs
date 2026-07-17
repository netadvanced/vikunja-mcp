#!/usr/bin/env node
/**
 * Regenerates src/types/generated/vikunja-openapi.d.ts from the vendored
 * Swagger 2.0 spec at docs/vikunja-openapi.json.
 *
 * openapi-typescript only understands OpenAPI 3.x, so the vendored Swagger
 * 2.0 document is first converted in-memory with swagger2openapi before
 * being handed to openapi-typescript.
 *
 * See docs/API-SPEC.md for the full refresh procedure (fetch the live spec,
 * regenerate, review the diff).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import swagger2openapi from 'swagger2openapi';
import openapiTS, { astToString } from 'openapi-typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const specPath = path.join(repoRoot, 'docs', 'vikunja-openapi.json');
const outPath = path.join(repoRoot, 'src', 'types', 'generated', 'vikunja-openapi.d.ts');

async function main() {
  const raw = JSON.parse(await readFile(specPath, 'utf8'));

  const { openapi } = await swagger2openapi.convertObj(raw, { patch: true, warnOnly: true });

  const ast = await openapiTS(openapi);
  const output = astToString(ast);

  await mkdir(path.dirname(outPath), { recursive: true });
  const banner =
    '/**\n' +
    ' * AUTO-GENERATED — do not edit by hand.\n' +
    ' *\n' +
    ` * Generated from docs/vikunja-openapi.json (Swagger 2.0 -> OpenAPI 3 -> TS)\n` +
    ' * via `npm run generate:api-types`. See docs/API-SPEC.md for the refresh\n' +
    ' * procedure.\n' +
    ' */\n\n';
  await writeFile(outPath, banner + output, 'utf8');

  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
