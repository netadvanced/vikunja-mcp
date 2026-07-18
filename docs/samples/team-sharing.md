# Sample: Team collaboration

Scenario from the [README](../../README.md#team-collaboration): granting access to a project by name — a person or a team — without looking up numeric user/team ids first, and being able to see who already has access in one call.

**Setup for this walkthrough:** project "Website Relaunch" (`id: 12`) currently has one direct user share (its owner) and one team share ("Design", team id 7, `write`). Vikunja has a registered user `alice`.

---

### 1. Share with a person by username

**User says:**
> "Give Alice write access to the Website Relaunch project."

**Tool call:**
```typescript
vikunja_projects({ subcommand: "share-with-user", projectId: 12, username: "alice", right: "write" })
```
Composite: resolves `"alice"` to a numeric user id via the global user search (`GET /users?s=`), adds her to the project (`PUT /projects/{id}/users`), then re-reads the project's user list to verify the grant actually landed — no numeric id required from you, and no unverified "probably worked" response. Pass `atomic: true` to have a failed verification automatically remove the just-added grant instead of just being reported (best-effort, not a real transaction — see [ENDPOINT-PLAYBOOK.md §5](../ENDPOINT-PLAYBOOK.md)).

**Resulting Vikunja UI state:**
Opening the project's Share panel in the browser now lists "alice" under "Shared with" with a "Write" permission badge, alongside the existing owner and the "Design" team share.

`[SCREENSHOT: Project share panel showing alice added under direct user shares with a "Write" permission badge]`

---

### 2. Share with a team by name

**User says:**
> "Also give the Marketing team read access."

**Tool call:**
```typescript
vikunja_projects({ subcommand: "share-with-team", projectId: 12, teamName: "Marketing", right: "read" })
```
Same resolve → add → verify shape as `share-with-user`, but resolves a team name via team search instead of a username.

**Resulting Vikunja UI state:**
The Share panel's "Teams" section now shows "Marketing" with a "Read" badge, next to "Design".

`[SCREENSHOT: Project share panel Teams section with Marketing (Read) added below Design (Write)]`

---

### 3. See everyone with access, in one call

**User says:**
> "Who can see this project right now?"

**Tool call:**
```typescript
vikunja_projects({ subcommand: "list-members", projectId: 12 })
```
Read composite: assembles direct user shares, direct team shares, and link shares for the project in one call — the same information the Share panel shows, without three separate reads.

**Resulting Vikunja UI state:**
No change — this is a read. The assistant's reply matches the Share panel exactly: owner, alice (write, user), Design (write, team), Marketing (read, team), plus any active link shares.

`[SCREENSHOT: Full project Share panel with users and teams sections both expanded]`

---

### 4. Fine-grained control when you already know the id

**User says:**
> "Actually, drop Marketing down to a link-share only — remove the team access."

**Tool call:**
```typescript
vikunja_projects({ subcommand: "remove-project-team", projectId: 12, teamId: 9 })
```
A primitive, not a composite — use these (`add-project-user`, `update-project-user-permission`, `remove-project-user`, `add-project-team`, `update-project-team-permission`, `remove-project-team`) when you already have the id and want a single direct call instead of the resolve-by-name composite.

**Resulting Vikunja UI state:**
"Marketing" disappears from the Teams section of the Share panel.

`[SCREENSHOT: Project share panel Teams section, Marketing entry removed, Design still present]`

---

## Try it on the local stack

See [docs/LOCAL-TESTING.md](../LOCAL-TESTING.md) to bring up `docker/e2e/docker-compose.yml`, create a second test user/team, and try sharing a project between them.
