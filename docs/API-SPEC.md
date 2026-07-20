# Vikunja OpenAPI Spec — Source of Truth

This document explains where the vendored Vikunja API spec comes from, how to
refresh it, and the rule for using it when implementing or auditing any
endpoint-touching code.

## The rule

**All endpoint work (path, HTTP verb, request body fields, response fields)
must be verified against `docs/vikunja-openapi.json`, never against
node-vikunja's bundled types.**

node-vikunja is end-of-life in this project and has confirmed drift from the
real API (see `docs/VIKUNJA_API_ISSUES.md` items #3, #7, and `docs/API_NOTES.md`
for concrete examples: task reminder shape, team member endpoints, the
`is_done_bucket`/`done_bucket_id` split, etc.). When node-vikunja's types and
the spec disagree, the spec wins — node-vikunja's types are not evidence of
anything.

The generated TypeScript types under `src/types/generated/vikunja-openapi.d.ts`
(see below) are derived mechanically from this same spec file, so importing
from there is equivalent to reading the spec, with compiler-checked accuracy.

## Where the spec comes from

**Primary source (recommended): the pinned local e2e container.** The
version-matrix report that motivated the Vikunja 2.4.0 alignment confirmed
that a running container's own `/api/v1/docs.json` reports an `info.version`
that matches its image tag *exactly* (e.g. `v2.4.0`, byte-for-byte, no
ahead-of-tag drift) — unlike `try.vikunja.io` (see below). Bring up the
pinned stack (`npm run e2e:up`, see `docs/LOCAL-TESTING.md`) and fetch
straight from it:

```bash
npm run fetch:api-spec:container
```

(equivalent to `curl -sS http://localhost:33456/api/v1/docs.json -o
docs/vikunja-openapi.json && jq -e . docs/vikunja-openapi.json`)

This gives an exactly-reproducible spec/behavior pairing tied to the pinned
tag in `docker/e2e/docker-compose.yml` — the spec documents precisely what
that tag serves, nothing ahead of it.

**Legacy/alternate source: `try.vikunja.io`.**

```bash
npm run fetch:api-spec
```

(equivalent to `curl -sS https://try.vikunja.io/api/v1/docs.json -o
docs/vikunja-openapi.json && jq -e . docs/vikunja-openapi.json`)

`try.vikunja.io` always runs `unstable` (upstream `main`), which is ahead of
any tagged release — confirmed as recently as the 2.4.0 alignment work,
where it reported a version string like `v2.4.0-N-g<hash>`, i.e. commits past
the tag. Use this only if you deliberately want to preview upstream changes
not yet in a tagged release; it is **not** the source used to align this
project's default e2e pin, and endpoints/fields it documents may not exist
yet in the pinned container.

It is **Swagger 2.0** (`"swagger": "2.0"`), not OpenAPI 3.x. As of the 2.4.0
alignment it declares:

- `info.version`: `v2.4.0` (fetched from the pinned container)
- `paths`: 126 endpoints
- `definitions`: 98 schemas

The file is committed to the repo (not gitignored) so that:
- Endpoint work can be verified against it without network access.
- Type generation (`npm run generate:api-types`) is reproducible from the
  vendored file alone and doesn't silently pick up upstream API changes
  mid-task.
- Diffs to the spec are reviewable in PRs like any other change.

## How to refresh it

1. Bring up the pinned e2e stack and fetch its spec (sanity-checking it
   parses):

   ```bash
   npm run e2e:up
   npm run fetch:api-spec:container
   ```

   (use `npm run fetch:api-spec` instead only if you deliberately want the
   ahead-of-tag `try.vikunja.io` spec — see "Where the spec comes from"
   above)

2. Regenerate the TypeScript types from the vendored spec:

   ```bash
   npm run generate:api-types
   ```

3. **Review the diff** of both `docs/vikunja-openapi.json` and
   `src/types/generated/vikunja-openapi.d.ts` before committing. Look
   specifically for:
   - Paths that changed verb, or were added/removed.
   - Renamed or retyped fields on schemas used by existing tools (a field
     rename shows up as a type error at every call site that used the old
     generated type, which is the point of wiring types into the build).
   - The `info.version` string, and note the old → new version in the PR
     description.

4. Run `npm run typecheck` — any call site that relied on generated types
   whose shape changed will fail to compile, which is the safety net this
   whole setup exists for.

## How type generation works

`openapi-typescript` (the type generator) only understands OpenAPI 3.x, but
the vendored spec is Swagger 2.0. `npm run generate:api-types` (see
`scripts/generate-api-types.mjs`) therefore:

1. Reads `docs/vikunja-openapi.json`.
2. Converts it in-memory to OpenAPI 3 with `swagger2openapi`.
3. Feeds the converted document to `openapi-typescript` to produce
   `src/types/generated/vikunja-openapi.d.ts`.

The generated file is committed (not gitignored) so that a clean checkout
builds without requiring regeneration or network access — CI and local builds
depend on the committed file, not on running the generator.

`src/types/generated/vikunja-openapi.d.ts` is **auto-generated — do not hand
edit it**. Its top-of-file banner says so; if you need a different shape for
a particular use, derive a local type from `components['schemas'][...]`
(e.g. with `Pick`/`Omit`/intersections) in your own module instead of editing
the generated file.

## Using the generated types

Import the `components` type and index into `components['schemas']` for a
model, or `components['requestBodies']` / response types under `paths` for
request/response shapes:

```typescript
import type { components } from '../../types/generated/vikunja-openapi';

type VikunjaBucket = components['schemas']['models.Bucket'];
```

`src/tools/projects/buckets.ts` uses exactly this pattern as the reference
example — see that file's `VikunjaBucket` type alias, which replaced a
hand-rolled interface that had silently drifted from the spec's actual
(all-optional) field shape.

**Note:** the vendored spec is Swagger 2.0, which does not model most schema
properties as `required`, so nearly every generated field comes out as
optional (`field?: T`) even when the API in practice always populates it on
reads. This is more honest than a hand-rolled `required` interface would be
in most cases (see the Bucket example above), but callers that know a field
is always present for their specific use may still need a local narrowing
type or a runtime check — don't blanket non-null-assert generated fields.

## Scope of this migration

Wiring the spec into the build (this document, the vendored file, generated
types, and the npm scripts) is Wave C infrastructure work. It intentionally
converts only **one** existing call site
(`src/tools/projects/buckets.ts`) as a demonstration of the pattern.
Migrating the rest of `src/utils/vikunja-rest.ts`'s consumers to generated
types is out of scope here and tracked as Wave D follow-up in issue #28 —
do not mass-migrate call sites as a side effect of unrelated work.
