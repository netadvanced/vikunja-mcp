# Agent battle-testing harness

Wave item T2 (tracking issue [netadvanced/vikunja-mcp-ng#28](https://github.com/netadvanced/vikunja-mcp-ng/issues/28)).
Part 2 of the testing plan (part 1 is the version-matrix runner, see
`docs/LOCAL-TESTING.md`).

This harness answers a different question than `npm run test:mcp` /
`npm run test:e2e:mcp` / `npm run test:matrix`. Those prove the tools work
correctly against a real Vikunja server. This harness measures something
else: **how well an actual AI agent copes with the tool surface** when
handed a natural-language task and nothing else -- no test-writer holding
its hand, no known-good call sequence. It's a UX benchmark for the tool
descriptions, argument shapes, and error messages themselves.

It spawns a real, headless `claude -p` session whose only tools are this
repo's own MCP server build (plus the one built-in tool needed to discover
it -- see "Why `ToolSearch` is granted" below) and grades the run two ways:

1. **DID IT WORK** -- verified with direct Vikunja REST calls
   (`scripts/battle/lib/verify.ts`), never the agent's own self-report.
2. **HOW HARD** -- parsed from the full JSONL transcript
   (`scripts/battle/lib/transcript-parser.ts` +
   `scripts/battle/lib/friction.ts`): tool-call count vs. a hand-estimated
   optimum, validation/argument errors, retries, wrong-tool attempts, tool
   discovery overhead, tokens, wall time, cost.

## COST WARNING -- deliberate, manual runs only

**Every invocation other than `--list` spends real money against the
configured Anthropic account.** This harness is **never** wired into CI, a
pre-commit hook, `npm test`, or any other automatic trigger -- it only runs
when a human deliberately types the command. Nothing in this repository
calls `scripts/battle/run-scenario.ts` on your behalf.

Rough costs observed while building this harness (Claude Code 2.1.214,
2026-07):

| What | Model | Cost |
|---|---|---|
| Cheapest scenario (`single-task-smoke`) | haiku | ~$0.07 |
| Cheapest scenario (`single-task-smoke`) | sonnet | typically a few times the haiku cost |
| Full 8-scenario library, one model | sonnet | expect several dollars -- run scenarios individually first if you're cost-sensitive |

Always start with `npm run battle -- --list` (free) and a single cheap
scenario before running `--all`.

## Quick start

```bash
# See what's available (no agent spawned, free).
npm run battle -- --list

# Run one scenario with the cheapest available model -- good for a first try.
npm run battle -- --scenario single-task-smoke --model haiku

# Run one scenario with the default model.
npm run battle -- --scenario q3-offsite-kanban

# Run the whole library (reads the cost warning above first).
npm run battle -- --all --model haiku

# Keep the created Vikunja data around after the run for manual inspection
# (normally cleaned up automatically -- see "Safety" below).
npm run battle -- --scenario subtask-breakdown --keep
```

Requires:

- The local e2e stack up and healthy: `npm run e2e:up` (see
  `docs/LOCAL-TESTING.md`). The runner talks to `http://localhost:33456`
  and mints its own credential the same way `docker/e2e/bootstrap.sh` /
  `scripts/mcp-e2e.ts` do -- it does not need `docker/e2e/.env` to exist.
- The `claude` CLI on `PATH`, logged in (this harness invokes it exactly
  like a human running `claude -p ...` at their own terminal).

Output goes to `battle-results/<run-id>/` (gitignored -- regenerate, don't
commit):

```
battle-results/<run-id>/
  <scenario-id>/
    prompt.txt          the exact prompt sent (after {{prefix}} substitution)
    mcp-config.json      the generated --mcp-config file for this run
    transcript.jsonl      full stream-json transcript
    stderr.log            claude CLI's stderr, if any
    verdict.json           { verification, friction } for this scenario
  friction-report.md      aggregated, cross-scenario markdown report
```

## Safety model

This mirrors the pattern in `scripts/mcp-e2e.ts` / `scripts/test-matrix.ts`
(see those files' headers for the fuller rationale) -- copied deliberately
rather than re-derived, since it protects against a real, previously-seen
incident class (a harness inheriting ambient Vikunja credentials and
running against a real account instead of the disposable stack):

- The target URL is hard-coded to `http://localhost:33456/api/v1`, only
  overridable via the harness-specific `BATTLE_VIKUNJA_URL` (never the
  ambient `VIKUNJA_URL`), and `assertLocalUrl` aborts the whole run before
  anything else happens if that URL doesn't resolve to
  localhost/127.0.0.1/`::1`. This repo directory has a real, production
  `.envrc` -- the harness never reads `.env`/`.envrc`.
- The credential handed to the agent's MCP server child process is always
  freshly minted against that (now guaranteed-local) stack via
  login + `PUT /tokens`, exactly like `docker/e2e/bootstrap.sh`. The
  ambient `VIKUNJA_API_TOKEN` is never consulted, and the generated
  `--mcp-config` hardcodes both the URL and the token in that config
  server's `env`, so even if the `claude` process itself inherited some
  ambient credential, the MCP server child it spawns still gets ours.
- Every scenario's Vikunja data is tagged with a unique
  `battle-<runid>-<scenario-id>-` title prefix. The runner sweeps by prefix
  **before and after every scenario**, plus a bare `battle-` sweep at the
  very start of each invocation to catch leftovers from a previous crashed
  run under a different run id. Pass `--keep` to skip the after-sweep for
  one scenario when you want to inspect the result in the Vikunja UI --
  clean it up yourself afterward, or just let the next run's sweep catch it.
- The stack itself is never brought up, torn down, or version-switched by
  this harness -- unlike `scripts/test-matrix.ts`, it assumes the stack is
  already up (`npm run e2e:up`) and only ever talks to it over HTTP.

## Why `ToolSearch` is granted

The runner passes `--tools ToolSearch` (not `--tools ''`). This was not the
first thing tried -- with zero built-in tools granted, a live smoke-test run
showed the agent could see `vikunja-battle`'s tools were configured
(`mcp_servers: [{name: "vikunja-battle", status: ...}]` in the transcript's
`init` line) but had literally no mechanism to ever load an individual
tool's schema and call it: this environment's MCP tools are **deferred
tools**, discovered via the built-in `ToolSearch` tool, and without
`ToolSearch` itself the agent just hallucinated fake tool-call-shaped text
instead of ever touching Vikunja. Granting exactly `ToolSearch` (and no
other built-in: no `Bash`, `Read`, `Write`, etc.) fixes that while keeping
every actual unit of work confined to `vikunja_*` calls.

This has a real consequence for how the friction numbers should be read:
`ToolSearch` calls are tracked separately
(`FrictionReport.toolSearchCallCount`), not folded into `toolCallCount` or
`wrongToolAttemptCount` -- discovering a tool isn't a mistake, it's required
plumbing in this environment. But the count itself is still a genuine
ergonomics signal worth reporting: the harness's own first live smoke run
(see "Live smoke test evidence" in the PR this shipped in) needed **8**
`ToolSearch` calls to do **3** actual `vikunja_*` calls -- a haiku-model
agent visibly floundering on the `select:name1,name2` query syntax before
landing on the right incantation. If a future Claude Code release changes
how MCP tools are exposed (no longer deferred, or a different discovery
mechanism), re-run the smoke test and update this section plus
`scripts/battle/run-scenario.ts`'s `--tools` value accordingly -- don't
assume this behavior is permanent; re-verify with
`claude -p --help` and a throwaway smoke run the way this section was
originally derived (see git history / the PR description for the exact
transcript that revealed it).

## The scenario library

`scripts/battle/scenarios/*.json`, each validated against `ScenarioSchema`
(`scripts/battle/types.ts`) at load time. Currently 10 scenarios:

| id | probes |
|---|---|
| `q3-offsite-kanban` | Pierre's canonical example: a single sentence hiding a multi-step composite (project + 3-column Kanban + 10 tasks + priorities + due dates) |
| `filter-high-priority-search` | the Vikunja filter query language (`docs/API_NOTES.md`'s filter notes) |
| `share-project-by-user` | project link-sharing discoverability |
| `subtask-breakdown` | subtask creation (Vikunja has no first-class subtask resource -- it's a task relation under the hood) |
| `bulk-priority-bump` | bulk-edit discoverability vs. one-call-per-task |
| `labels-due-date-combo` | label creation + application + due dates combined in one ask (create-then-apply path only) |
| `single-task-smoke` | deliberately the cheapest scenario -- use this one for a first try or a live-smoke proof |
| `mixed-priority-batch` | varying a per-item field within a single batch-creation call |
| `existing-label-reuse` | applying an already-existing label (find-then-apply path -- seeded via `setup`, closes the evidence gap `labels-due-date-combo` leaves open) |
| `project-rename-share` | project create + rename + share-by-name in one prompt -- probes the `title`-vs-`name` field-naming footgun (`vikunja_projects`' flat args object has both) and exercises the share-by-name composite (`create-share` with a `name`) |

### Live evidence runs

Scenarios added by E5 (`existing-label-reuse`, `project-rename-share`) were
never executed live at the time they shipped -- this is that first live run,
one shot each, sonnet model, tracking issue #28's Q2 (2026-07-20):

- `existing-label-reuse` -- last run 2026-07-20, **PASS, clean**: 6 calls vs.
  optimal 3 (2.0x, fully explained by one `apply-label` call per task -- no
  bulk-apply composite exists), 0 validation errors, 0 retries, agent found
  the seeded label via `vikunja_labels list --search` and applied its
  existing id to all 3 tasks -- no duplicate label created. Confirms the
  parked **label-ensure composite** verdict; stays parked.
- `project-rename-share` -- last run 2026-07-20, **PASS verification, but
  high friction, REOPENED**: 15 calls vs. optimal 3 (5.0x), 3 validation
  errors, 3 retries. The agent's first `create-share` call passed `title`
  (the project-rename field) instead of `name` (the share-label field) --
  silently accepted, producing an unnamed share instead of an error, i.e.
  the exact `title`-vs-`name` confusion this scenario was built to probe.
  Recovering from that then hit a second, previously-unknown bug: repeated
  `delete-share`/`get-share` calls against the just-created share id
  returned spurious "not found" (`src/tools/projects/sharing.ts`) before the
  agent gave up cleaning up and issued a second, correctly-named
  `create-share` call, leaving the first (unnamed, undeletable-by-agent)
  share behind for the harness's own project-delete cleanup to reclaim.
  Reopens the parked **`name` vs `title` ergonomics** queue item with this
  evidence; the delete-share "not found" bug is a new, separate finding
  worth its own follow-up item (not fixed here -- out of scope for this
  evidence-only item).

### Anatomy of a scenario file

```jsonc
{
  "id": "kebab-case-id",
  "title": "Human-readable title",
  "description": "Optional: why this scenario exists / what it probes.",
  // {{prefix}} is substituted with the unique battle-<runid>-<id>- prefix
  // at run time, in BOTH the prompt and every verify check below -- always
  // use it for every title the prompt asks the agent to create, so
  // verification and cleanup can find (and only find) this run's own data.
  "promptTemplate": "Create a project called \"{{prefix}}Demo\" with ...",
  // Hand-estimated minimum vikunja_* tool calls an expert user would need.
  // Excludes ToolSearch discovery calls (see above) -- this is purely about
  // the actual units of work.
  "optimalCallCount": 3,
  // Optional: pin a model for this scenario specifically (overridden by
  // the CLI's own --model flag if both are given).
  "model": "haiku",
  // Optional: seed data via direct REST (scripts/battle/lib/setup.ts),
  // executed after cleanup-before and before the agent is spawned. Use this
  // when the scenario needs the agent to act on data that already existed
  // rather than data it just created itself in the same run (e.g. applying
  // an already-existing label -- see existing-label-reuse.json). Every
  // string field supports {{prefix}} the same as verify checks do, so
  // seeded data is swept by the same prefix-based cleanup as everything
  // else. Currently one action type: { "type": "create-label", "title": "..." }.
  "setup": [{ "type": "create-label", "title": "{{prefix}}existing-tag" }],
  "verify": [
    { "type": "project-exists", "titleContains": "{{prefix}}Demo" }
    // ... see scripts/battle/types.ts's VerifyCheck union for every
    // available check type (min-tasks-in-project, min-buckets-in-project,
    // tasks-field-match-count, tasks-due-date-in-range, label-exists,
    // tasks-with-label-count, task-has-subtasks, project-has-share).
  ]
}
```

### Adding a scenario

1. Drop a new `scripts/battle/scenarios/<id>.json` file (any filename
   ending in `.json` is picked up; the `id` field inside is what matters).
2. Write `promptTemplate` as a single, natural sentence a real user might
   type -- resist the urge to spell out the exact tool calls. The whole
   point is testing what the agent does with an under-specified ask.
3. Reference `{{prefix}}` in every title the prompt asks the agent to
   create, and reuse those same substrings in the matching `verify` checks'
   `*TitleContains` fields.
4. Hand-estimate `optimalCallCount`: how many `vikunja_*` calls would an
   expert user of this tool surface need? Check `src/tools/*/index.ts`'s
   subcommand lists and `docs/API_NOTES.md` for the composite operations
   already available (`bulk-create` accepts per-task `priority`/`dueDate`/
   `labels` in one call, `create-subtask`, `share-with-user`, etc.) --
   the estimate should reflect what's *possible* with this tool surface,
   not a naive one-call-per-field count.
5. Add a unit test in `tests/battle/scenario.test.ts` if the check verifies
   a shape not already covered.
6. If the scenario needs the agent to act on pre-existing data (rather than
   data it creates in the same prompt), add a `setup` action instead of
   trying to phrase the prompt around data the agent itself just created --
   see `existing-label-reuse.json` and `scripts/battle/lib/setup.ts`.
7. `npm run battle -- --list` to confirm it loads and validates.
8. `npm run battle -- --scenario <id> --model haiku` for a cheap first run.

## Testing the harness itself (no live Claude needed)

`scripts/battle/lib/transcript-parser.ts`, `scripts/battle/lib/friction.ts`,
and `scripts/battle/lib/verify.ts` (the pieces this whole harness's grading
depends on) are unit-tested against static, recorded fixtures --
`tests/battle/fixtures/*.jsonl` and a lightweight in-memory fake of
`VikunjaRestClient` (`tests/battle/helpers/fake-rest-client.ts`)
respectively. `filter-syntax-real-errors.jsonl` is derived from a real
campaign transcript (run `20260718-211659-05yr35`, scenario
`filter-high-priority-search`) rather than hand-written -- when
`invalidArgErrorCount`'s `VALIDATION_ERROR_PATTERNS` misses a genuine failure
in a future campaign, add the real error text as a new fixture the same way
rather than a synthetic one, so the regex list stays grounded in what
Vikunja/the tools actually say. Run them like any other test:

```bash
jest tests/battle
```

These are the CI-quality gate for this harness's own correctness; they run
as part of `npm run test:coverage` like everything else in `tests/`. Only
`scripts/battle/run-scenario.ts --scenario ... ` itself spends money --
everything under `tests/battle/` is free and deterministic.

## Reading the friction report

`friction-report.md` ranks scenarios by `callCountRatio` (actual calls /
hand-estimated optimum) descending -- the scenarios where the agent worked
hardest relative to what should have been possible come first. Look for:

- **High `callCountRatio`** with a PASS verdict: the agent got there, but
  the tool surface made it take more calls than it should have -- a
  candidate for a new composite tool, or a better tool description nudging
  the agent toward the cheaper path.
- **Nonzero `invalidArgErrorCount`**: the agent's first guess at argument
  shapes was wrong -- a discoverability smoking gun. Check whether the
  tool's Zod schema description/examples could make the correct shape more
  obvious.
- **Nonzero `retryCount`**: the agent repeated a byte-identical failed call
  -- often paired with a validation error above, but sometimes a sign the
  error message itself didn't give the agent anything to act on.
- **High `toolSearchCallCount` relative to `toolCallCount`**: the agent
  spent more effort finding the right tool than using it (see "Why
  `ToolSearch` is granted" above).
- **FAIL verdicts**: read the "Failed checks" list for that scenario --
  each failed check's `detail` string says exactly what REST state was
  expected vs. observed.

This report format is meant to feed future tool-description and
composite-tool improvement waves directly -- when a friction pattern
recurs across multiple runs of the same scenario, that's the signal to act
on, not a single run's noise.

## Its place in the release checklist

This harness is now part of `docs/RELEASING.md`'s pre-tag checklist (§2,
Step 4, "Battle smoke"): at minimum the cheapest scenario
(`single-task-smoke`) runs before every release, and the full scenario
library (`--all`) runs when a release changes tool descriptions, argument
shapes, error messages, or subcommands. Its friction heuristics
(validation-error pattern matching, the retry definition, etc.) are still
evolving with real runs, so read the friction report with that in mind
rather than treating a single run's noise as load-bearing. It remains
explicitly **not an automated gate** -- it spawns a paid agent session and
must never become something CI or a hook runs unattended.

## Re-deriving the transcript shape

`scripts/battle/lib/transcript-parser.ts`'s header documents the exact
`claude -p --output-format stream-json --verbose` line shapes it expects,
empirically confirmed against Claude Code 2.1.214 while building this
harness (`claude -p --help` was the source of truth for available flags --
run it yourself before assuming any flag mentioned here still exists).
If a future CLI version changes the stream-json shape, the parser will
surface it as a `parseWarnings` entry (surfaced in turn as a friction note)
rather than silently misreporting -- treat any `parseWarnings` in a run's
`verdict.json` as a signal to re-check this file's assumptions against a
fresh `claude -p --help` and a throwaway smoke transcript before trusting
that run's friction numbers.
