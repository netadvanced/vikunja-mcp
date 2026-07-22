#!/usr/bin/env node
/**
 * Regenerates src/types/generated/vikunja-openapi-v2.d.ts from the vendored
 * OpenAPI 3.x spec at docs/vikunja-openapi-v2.json.
 *
 * Unlike the v1 flow (scripts/generate-api-types.mjs), the v2 spec is
 * already OpenAPI 3.x (not Swagger 2.0), so it is handed to
 * openapi-typescript directly with no swagger2openapi conversion step.
 *
 * See docs/API-SPEC.md for the full refresh procedure (fetch the live spec,
 * regenerate, review the diff).
 *
 * NOTE: this is spec/type groundwork only (issue #28 vendor-v2-spec-types).
 * The generated file is not imported by any runtime src/ code yet.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const specPath = path.join(repoRoot, 'docs', 'vikunja-openapi-v2.json');
const outPath = path.join(repoRoot, 'src', 'types', 'generated', 'vikunja-openapi-v2.d.ts');

async function main() {
  const raw = JSON.parse(await readFile(specPath, 'utf8'));

  const ast = await openapiTS(raw);
  const output = astToString(ast);

  await mkdir(path.dirname(outPath), { recursive: true });
  const banner =
    '/**\n' +
    ' * AUTO-GENERATED — do not edit by hand.\n' +
    ' *\n' +
    ` * Generated from docs/vikunja-openapi-v2.json (OpenAPI 3.x -> TS)\n` +
    ' * via `npm run generate:api-types:v2`. See docs/API-SPEC.md for the refresh\n' +
    ' * procedure.\n' +
    ' *\n' +
    ' * NOT YET WIRED INTO RUNTIME: this is spec/type groundwork for the v2 API\n' +
    ' * (tracking issue #28, item vendor-v2-spec-types). No src/ code imports from\n' +
    ' * this file yet.\n' +
    ' */\n\n';
  await writeFile(outPath, banner + output, 'utf8');

  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
