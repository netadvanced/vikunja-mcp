# Vikunja MCP Server

> 👋 **Why this fork exists:** We rely on this project and noticed the [upstream repo](https://github.com/democratize-technology/vikunja-mcp) had gone quiet, with a growing backlog of open PRs and issues. So we've taken over active maintenance here — triaging and resolving most of that backlog (tracked [in this issue](https://github.com/netadvanced/vikunja-mcp/issues/19)). Full credit to the original authors for the foundation. If they'd like to pick it back up, we'll gladly hand the reins back — or work together.

A Model Context Protocol (MCP) server that enables AI assistants to interact with Vikunja task management instances.

## Features

- **Subcommand-based tools** for intuitive AI interactions
- **Session-based authentication** with automatic token management
- **Full task management** operations implemented
- **Complete project management** with CRUD operations
- **Label management** for organizing tasks
- **Team operations** for collaboration (get/update/members limited by API)
- **User management** with settings and search
- **Webhook management** for project automation
- **Batch import** tasks from CSV or JSON files
- **Input validation** for dates, IDs, and hex colors
- **Efficient diff-based updates** for assignees
- **TypeScript with strict mode** for type safety
- **Comprehensive error handling** with typed errors and centralized utilities
- **Production-ready retry logic** with opossum circuit breaker for resilience
- **Enhanced security** with Zod-based input validation and DoS protection
- **Rate limiting protection** against DoS attacks with configurable limits
- **Memory protection** with pagination limits and usage monitoring
- **Simplified architecture** with 90% code reduction for maintainability

## 🚀 Major Architectural Improvements (v0.2.0)

This release represents a **massive architectural simplification** that eliminates technical debt while enhancing security and reliability:

### Storage Architecture Refactoring (90% Code Reduction)
- **Before**: 33 files, 9,803 lines of over-engineered storage system
- **After**: 4 files, essential functionality only
- **Eliminated**: Complex orchestrators, health monitors, statistics tracking, migration systems
- **Result**: Same external API with dramatically improved maintainability

### Zod-Based Filter System (850+ Lines Removed)
- **Before**: Custom tokenizer, parser, and validator with security vulnerabilities
- **After**: Secure Zod schema validation with production-ready parsing
- **Enhanced**: DoS protection, input sanitization, and comprehensive error handling
- **Result**: Faster parsing, better security, and enterprise-grade reliability

### Production-Ready Retry System (580+ Lines Replaced)
- **Before**: Custom retry logic with maintenance overhead
- **After**: Battle-tested opossum circuit breaker library
- **Features**: Circuit breaker state sharing, automatic recovery, comprehensive monitoring
- **Result**: Production resilience with battle-tested patterns

### Zero Breaking Changes
All improvements maintain **100% backward compatibility** with existing implementations while providing enhanced reliability and security.

## Requirements

- Node.js 20+ (LTS versions only)
- Vikunja instance with API access
- API token (starting with `tk_`) or JWT token for authentication

## Installation

### Option 1: Install from NPM (Recommended)

The easiest way to use vikunja-mcp is through npx in your Claude Desktop or other MCP-compatible client configuration:

```json
{
  "vikunja": {
    "command": "npx",
    "args": ["-y", "@democratize-technology/vikunja-mcp"],
    "env": {
      "VIKUNJA_URL": "https://your-vikunja-instance.com/api/v1",
      "VIKUNJA_API_TOKEN": "your-api-token"
    }
  }
}
```

### Option 2: Local Development

For development or customization:

```bash
git clone https://github.com/democratize-technology/vikunja-mcp.git
cd vikunja-mcp
npm install
npm run build
```

Then configure your MCP client:

```json
{
  "vikunja": {
    "command": "node",
    "args": ["/path/to/vikunja-mcp/dist/index.js"],
    "env": {
      "VIKUNJA_URL": "https://your-vikunja-instance.com/api/v1",
      "VIKUNJA_API_TOKEN": "your-api-token"
    }
  }
}
```

## Configuration

### Logging Configuration

The server includes a structured logging system. Configure it via environment variables:

```bash
# Enable debug logging (default: false)
DEBUG=true

# Set specific log level (error, warn, info, debug)
# If not set, defaults to 'info' (or 'debug' if DEBUG=true)
LOG_LEVEL=debug
```

Log output includes timestamps and log levels:
```
[2025-05-25T17:00:00.000Z] [INFO] Vikunja MCP server started
[2025-05-25T17:00:00.100Z] [DEBUG] Executing tasks tool { subcommand: 'list', args: {...} }
```

All logs are written to stderr to keep stdout reserved for MCP protocol communication.

## Authentication Methods

The Vikunja MCP server supports two authentication methods, each with different capabilities:

### API Token Authentication (Default)

API tokens are the standard authentication method for Vikunja:

- **How to obtain:** Go to Vikunja Settings → API Tokens → Create new token
- **Token format:** Starts with `tk_` (e.g., `tk_abc123def456`)
- **Capabilities:** Full access to tasks, projects, labels, teams, and webhooks
- **Limitations:** Cannot access user-specific endpoints (user profile, settings, export)
- **Best for:** Automation, CI/CD, and general task management

### JWT Authentication (Advanced)

JWT (JSON Web Token) authentication provides full access to all Vikunja endpoints:

- **How to obtain:** Extract from your browser session (see instructions below)
- **Token format:** Long string starting with `eyJ` (standard JWT format)
- **Capabilities:** Full access to all endpoints including user management and export
- **Limitations:** Tokens expire (typically after 24 hours)
- **Best for:** User management, data export, and operations requiring user context

#### How to Extract Your JWT Token

1. **Log into Vikunja** in your web browser
2. **Open Developer Tools** (F12 or right-click → Inspect)
3. **Go to the Application/Storage tab**
4. **Find the JWT token:**
   - Look in Local Storage → your Vikunja domain
   - Find the key named `token` or similar
   - The value is your JWT token
5. **Copy the entire token value** (it's quite long)

#### Using JWT Authentication

```typescript
// Connect with JWT token - automatically detected!
vikunja_auth.connect({
  apiUrl: "https://your-vikunja-instance.com/api/v1",
  apiToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
})
```

**Important Notes:**
- JWT tokens expire; you'll need to extract a new one when it expires
- Token type is automatically detected based on format (no flag needed)
- Some tools (users, export) are only available with JWT authentication

## Quick Start

1. **Set up authentication (if not using environment variables):**
   ```typescript
   vikunja_auth.connect({
     apiUrl: "https://your-vikunja-instance.com/api/v1",
     apiToken: "your-api-token"
   })
   ```

2. **Create your first task:**
   ```typescript
   vikunja_tasks.create({
     projectId: 1,
     title: "My first task via MCP!"
   })
   ```

3. **List all your tasks:**
   ```typescript
   vikunja_tasks.list({ allProjects: true })
   ```

## Usage

The MCP server exposes tools with subcommands. All operations require authentication first (either via environment variables or manual connection).

### Authentication

```typescript
// Connect with API token (automatically detected)
vikunja_auth.connect({
  apiUrl: "https://your-vikunja-instance.com/api/v1",
  apiToken: "tk_your-api-token"
})

// Connect with JWT token (automatically detected, enables additional tools: users, export)
vikunja_auth.connect({
  apiUrl: "https://your-vikunja-instance.com/api/v1",
  apiToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
})

// Check authentication status
vikunja_auth.status()

// Disconnect and clean up resources
vikunja_auth.disconnect()
```

### Task Management Examples

```typescript
// List all tasks across all projects
vikunja_tasks.list({ allProjects: true })

// List tasks for a specific project with pagination
vikunja_tasks.list({
  projectId: 1,
  page: 1,
  perPage: 20,
  sort: "due_date"
})

// List tasks with filters (high priority, not done)
vikunja_tasks.list({
  filter: "(priority >= 4 && done = false)"
})

// List tasks with simple filter
vikunja_tasks.list({
  filter: "priority >= 3"
})

// List tasks with complex filter conditions
vikunja_tasks.list({
  filter: "(priority >= 3 && priority <= 5) || (done = true && updated > '2024-01-01')"
})

// Combine filter with search
vikunja_tasks.list({
  filter: "priority >= 4",
  search: "urgent"
})

// Create a new task with labels and assignees
vikunja_tasks.create({
  projectId: 1,
  title: "Complete documentation",
  description: "Update README with examples",
  dueDate: "2024-12-31T23:59:59Z",
  priority: 3,
  labels: [1, 2],      // Label IDs
  assignees: [1, 3]    // User IDs
})

// Create a recurring task (repeats every week)
vikunja_tasks.create({
  projectId: 1,
  title: "Weekly team meeting",
  description: "Sync up with the team",
  dueDate: "2024-12-01T10:00:00Z",
  repeatAfter: 7,      // Number of units
  repeatMode: "day"    // Unit: "day", "week", "month", or "year"
})

// Create a monthly recurring task
vikunja_tasks.create({
  projectId: 1,
  title: "Monthly report",
  repeatAfter: 1,
  repeatMode: "month"
})

// Get detailed information about a task
vikunja_tasks.get({ id: 123 })

// Update a task (partial updates supported)
vikunja_tasks.update({
  id: 123,
  done: true,
  priority: 5
})

// Move a task to another project (full-model merge; verified after update)
vikunja_tasks.update({
  id: 123,
  projectId: 5
})

// Update recurring settings on an existing task
vikunja_tasks.update({
  id: 123,
  repeatAfter: 14,     // Change to bi-weekly
  repeatMode: "day"
})

// Update task assignees (uses efficient diff-based approach)
vikunja_tasks.update({
  id: 123,
  assignees: [1, 2, 4]  // Only adds/removes differences
})

// Delete a task
vikunja_tasks.delete({ id: 123 })

// Bulk assign users to a task
vikunja_tasks.assign({
  id: 123,
  assignees: [2, 3, 4]
})

// Remove users from a task
vikunja_tasks.unassign({
  id: 123,
  assignees: [2, 4]  // Removes only these users
})

// List all assignees for a task (calls the dedicated
// GET /tasks/{taskID}/assignees endpoint, not GET /tasks/{id})
vikunja_tasks.list-assignees({ id: 123 })

// Search assignees by username with pagination
vikunja_tasks.list-assignees({ id: 123, search: "ali", page: 1, perPage: 20 })

// List a task's attachments
vikunja_tasks.list-attachments({ id: 123 })

// Get metadata (filename, size, mime, created, author) for one attachment
vikunja_tasks.get-attachment-info({ id: 123, attachmentId: 5 })

// Delete an attachment
vikunja_tasks.delete-attachment({ id: 123, attachmentId: 5 })

// Get a direct download URL for an attachment (MCP has no binary channel,
// so this returns the URL + auth guidance instead of the file itself)
vikunja_tasks.download-attachment({ id: 123, attachmentId: 5 })

// Add a comment to a task
vikunja_tasks.comment({
  id: 123,
  comment: "This task is now complete!"
})

// List all comments on a task
vikunja_tasks.comment({ id: 123 })

// Create a task relation (e.g., subtask, blocking, related)
vikunja_tasks.relate({
  id: 123,
  otherTaskId: 124,
  relationKind: "subtask"  // 124 is a subtask of 123
})

// Available relation kinds:
// - subtask: Other task is a subtask of this task
// - parenttask: Other task is the parent of this task
// - related: Tasks are related
// - duplicateof: This task is a duplicate of the other
// - duplicates: Other task is a duplicate of this one
// - blocking: This task blocks the other
// - blocked: This task is blocked by the other
// - precedes: This task precedes the other
// - follows: This task follows the other
// - copiedfrom: This task was copied from the other
// - copiedto: Other task was copied from this one

// Remove a task relation
vikunja_tasks.unrelate({
  id: 123,
  otherTaskId: 124,
  relationKind: "subtask"
})

// Get all relations for a task
vikunja_tasks.relations({ id: 123 })

// Add a reminder to a task
vikunja_tasks.add-reminder({
  id: 123,
  reminderDate: "2024-12-25T10:00:00Z"
})

// List all reminders for a task (shows each reminder's reminderIndex)
vikunja_tasks.list-reminders({ id: 123 })

// Remove a specific reminder from a task. Vikunja's API has no reminder id,
// so identify the reminder by its exact date string and/or its zero-based
// reminderIndex from list-reminders.
vikunja_tasks.remove-reminder({
  id: 123,
  reminderDate: "2024-12-25T10:00:00Z"
})
// or equivalently:
vikunja_tasks.remove-reminder({
  id: 123,
  reminderIndex: 0
})

// Bulk create multiple tasks at once (max 100)
vikunja_tasks.bulk-create({
  projectId: 1,
  tasks: [
    {
      title: "Task 1",
      description: "First task",
      priority: 3,
      labels: [1, 2]
    },
    {
      title: "Task 2", 
      dueDate: "2024-12-31T23:59:59Z",
      assignees: [1]
    },
    {
      title: "Weekly standup",
      repeatAfter: 7,
      repeatMode: "day"
    }
  ]
})

// Bulk update multiple tasks with the same field value
// (fetch+merge per task — safe against Vikunja full-replace field wipes)
vikunja_tasks.bulk-update({
  taskIds: [123, 124, 125],
  field: "done",          // Field to update
  value: true             // New value for all tasks
})

// Other bulk update examples
vikunja_tasks.bulk-update({
  taskIds: [123, 124, 125],
  field: "priority",
  value: 5
})

vikunja_tasks.bulk-update({
  taskIds: [123, 124],
  field: "project_id",
  value: 2               // Move tasks to different project
})

vikunja_tasks.bulk-update({
  taskIds: [123, 124, 125],
  field: "labels",
  value: [1, 3, 5]       // Set same labels on all tasks
})

// Bulk delete multiple tasks (max 100)
vikunja_tasks.bulk-delete({
  taskIds: [123, 124, 125]
})

// Batch import tasks from CSV or JSON
vikunja_batch_import({
  projectId: 1,
  format: "json",
  data: JSON.stringify([
    {
      title: "Task 1",
      description: "First imported task",
      priority: 3,
      dueDate: "2024-12-31T23:59:59Z"
    },
    {
      title: "Task 2",
      labels: ["bug", "urgent"],  // Will look up label IDs by name
      assignees: ["john.doe"]      // Will look up user IDs by username
    }
  ])
})

// Import from CSV with headers
vikunja_batch_import({
  projectId: 1,
  format: "csv",
  data: `title,description,priority,dueDate,labels,assignees
"Task 1","Description with, comma",3,2024-12-31T23:59:59Z,"bug;feature","john.doe"
"Task 2","Another task",5,,"urgent","john.doe;jane.smith"`
})

// Dry run to validate without creating tasks
vikunja_batch_import({
  projectId: 1,
  format: "json",
  data: JSON.stringify([...]),
  dryRun: true  // Only validates, doesn't create tasks
})

// Continue on errors instead of stopping
vikunja_batch_import({
  projectId: 1,
  format: "csv",
  data: csvData,
  skipErrors: true  // Skip invalid tasks and continue with valid ones
})
```

### Data Export Examples

```typescript
// Export a project with all its data
vikunja_export_project({
  projectId: 1,
  includeChildren: false  // Only export the specified project
})

// Export a project including all child projects
vikunja_export_project({
  projectId: 1,
  includeChildren: true  // Recursively export child projects
})

// The export returns JSON data with the following structure:
// {
//   project: { ... },        // Project details
//   tasks: [ ... ],          // All tasks in the project
//   labels: [ ... ],         // All labels used in tasks
//   child_projects: [ ... ], // Nested child project exports (if includeChildren: true)
//   exported_at: "...",      // ISO timestamp of export
//   version: "1.0.0"         // Export format version
// }

// Request a full user data export (sent via email)
vikunja_request_user_export({
  password: "your-password"  // Required for security
})

// Confirm a previously requested user data export is ready
// NOTE: per the Vikunja API, this endpoint returns only a confirmation
// message, not the export file itself. The MCP protocol has no binary
// attachment support, so the exported archive cannot be retrieved through
// this tool -- download it from the Vikunja web UI or a direct API client.
vikunja_download_user_export({
  password: "your-password"  // Required for security
})
```

### Project Management Examples

```typescript
// List all projects
vikunja_projects.list()

// List projects with search and pagination
vikunja_projects.list({
  search: "frontend",
  page: 1,
  perPage: 10,
  isArchived: false
})

// Get a specific project
vikunja_projects.get({ id: 1 })

// Create a new project
vikunja_projects.create({
  title: "New Frontend Project",
  description: "React-based web application",
  hexColor: "#4287f5"
})

// Update a project
vikunja_projects.update({
  id: 1,
  title: "Updated Project Name",
  isArchived: true
})

// Archive a project
vikunja_projects.archive({ id: 1 })

// Unarchive a project
vikunja_projects.unarchive({ id: 1 })

// Delete a project
vikunja_projects.delete({ id: 1 })

// --- Project Hierarchy Management ---

// Create a child project
vikunja_projects.create({
  title: "Frontend Module",
  description: "React components",
  parentProjectId: 1,  // Will be a child of project 1
  hexColor: "#3498db"
})

// Get all direct children of a project
vikunja_projects.get-children({ id: 1 })
// Returns: Array of projects that have parentProjectId = 1

// Get complete project hierarchy as a tree
vikunja_projects.get-tree({ id: 1 })
// Returns: Project with nested children structure
// {
//   id: 1,
//   title: "Main Project",
//   children: [
//     {
//       id: 2,
//       title: "Frontend Module",
//       children: [
//         { id: 4, title: "Components", children: [] },
//         { id: 5, title: "Styles", children: [] }
//       ]
//     },
//     {
//       id: 3,
//       title: "Backend Module",
//       children: []
//     }
//   ]
// }

// Get breadcrumb path from root to a project
vikunja_projects.get-breadcrumb({ id: 5 })
// Returns: Array of projects from root to target
// [
//   { id: 1, title: "Main Project" },
//   { id: 2, title: "Frontend Module" },
//   { id: 5, title: "Styles" }
// ]
// Also includes a formatted path: "Main Project > Frontend Module > Styles"

// Move a project to a new parent
vikunja_projects.move({ 
  id: 5,              // Project to move
  parentProjectId: 3  // New parent
})
// Validates against circular references and depth limits

// Move a project to root level (no parent)
vikunja_projects.move({ 
  id: 5,
  parentProjectId: undefined
})

// --- Project Sharing ---

// Create a read-only share link
vikunja_projects.create-share({ 
  id: 1,
  right: 0,  // 0=Read, 1=Write, 2=Admin
  label: "Public read-only access"
})

// Create a password-protected share with write access
vikunja_projects.create-share({ 
  id: 1,
  right: 1,
  password: "securepassword123",
  label: "Team collaboration link"
})

// Create an expiring share link
vikunja_projects.create-share({ 
  id: 1,
  right: 0,
  expires: "2025-12-31T23:59:59Z",
  label: "Temporary access until year end"
})

// List all shares for a project
vikunja_projects.list-shares({ id: 1 })

// Get details of a specific share
vikunja_projects.get-share({ 
  id: 1, 
  shareId: 123 
})

// Delete a share link
vikunja_projects.delete-share({ 
  id: 1, 
  shareId: 123 
})

// Authenticate to access a shared project
vikunja_projects.auth-share({ 
  shareHash: "abc123def456" 
})

// Authenticate to a password-protected share
vikunja_projects.auth-share({ 
  shareHash: "abc123def456",
  password: "securepassword123"
})

// --- Project Views ---

// List all views of a project (list, gantt, table, kanban)
vikunja_projects.list-views({ id: 1 })

// Get a single view by id
vikunja_projects.get-view({ id: 1, viewId: 3 })

// Create a new view
vikunja_projects.create-view({
  id: 1,
  title: "Sprint Board",
  viewKind: "kanban",
  bucketConfigurationMode: "manual"
})

// Update a view (fetches current view and merges -- omitted fields are preserved)
vikunja_projects.update-view({ id: 1, viewId: 3, title: "Renamed View" })

// Delete a view
vikunja_projects.delete-view({ id: 1, viewId: 3 })

// Set a view's "done" bucket -- the only way to *set* isDoneBucket
// (list-buckets can only read it, since it lives on the view, not the bucket)
vikunja_projects.set-done-bucket({ id: 1, bucketId: 42 })
// viewId is auto-resolved to the project's Kanban view when omitted

// --- Kanban Buckets ---

// List the Kanban buckets (columns) of a project
vikunja_projects.list-buckets({ id: 1 })
// viewId is auto-resolved to the project's Kanban view when omitted

// Create a new bucket
vikunja_projects.create-bucket({ id: 1, title: "In Review", limit: 5 })

// Rename a bucket, referencing it by id...
vikunja_projects.update-bucket({ id: 1, bucketId: 42, title: "In Review" })

// ...or by its current title -- resolved to an id internally
vikunja_projects.update-bucket({ id: 1, bucketTitle: "Doing", limit: 3 })

// Delete a bucket (dissociates its tasks, does not delete them)
vikunja_projects.delete-bucket({ id: 1, bucketTitle: "Backlog" })

// List a view's tasks in real server-side (Kanban card) order, paginated
vikunja_projects.list-view-tasks({ id: 1, page: 1, perPage: 50 })

// --- Duplicate Project ---

// Duplicate a project to the root level (tasks, labels, comments,
// attachments, relations, and Kanban data are copied; shares are not
// unless duplicateShares is set)
vikunja_projects.duplicate({ id: 1 })

// Duplicate into a specific parent project, including its shares
vikunja_projects.duplicate({ id: 1, parentProjectId: 5, duplicateShares: true })

// --- Direct Project Sharing (users & teams) ---
// Distinct from link shares above: grants access to a specific, named
// account rather than anyone with a link. See docs/API-COVERAGE.md — this
// was a HIGH-priority gap (only link sharing existed before Wave D).

// Composite: share with a user by username. Resolves the username to a
// user id, grants access, then verifies the grant actually landed.
vikunja_projects.share-with-user({
  projectId: 1,
  username: "alice",
  right: "write"   // 'read' | 'write' | 'admin', or 0 | 1 | 2
})

// Composite: share with a team by name (same resolve -> add -> verify shape).
vikunja_projects.share-with-team({
  projectId: 1,
  teamName: "Engineering",
  right: "admin"
})

// Opt into atomic rollback: if verification fails, the just-added grant is
// removed rather than left in an unverified state. Default is best-effort
// (the grant is left in place and reported for manual follow-up) — this is
// still not a real transaction; see docs/ENDPOINT-PLAYBOOK.md §5.
vikunja_projects.share-with-user({
  projectId: 1,
  username: "alice",
  right: "write",
  atomic: true
})

// Read composite: who has access to this project — direct users, direct
// teams, and link shares — in one call.
vikunja_projects.list-members({ projectId: 1 })

// Primitives (fine-grained control; share-with-user/team are the
// recommended path for the common case of "give this named user/team access"):
vikunja_projects.list-project-users({ projectId: 1 })
vikunja_projects.search-project-users({ projectId: 1, search: "ali" })
vikunja_projects.add-project-user({ projectId: 1, username: "alice", right: "read" })
vikunja_projects.update-project-user-permission({ projectId: 1, userId: 42, right: "admin" })
vikunja_projects.remove-project-user({ projectId: 1, userId: 42 })

vikunja_projects.list-project-teams({ projectId: 1 })
vikunja_projects.add-project-team({ projectId: 1, teamId: 7, right: "write" })
vikunja_projects.update-project-team-permission({ projectId: 1, teamId: 7, right: "read" })
vikunja_projects.remove-project-team({ projectId: 1, teamId: 7 })
```

### Label Management Examples

```typescript
// List all labels
vikunja_labels.list()

// Search for labels
vikunja_labels.list({
  search: "bug",
  page: 1,
  perPage: 20
})

// Get a specific label
vikunja_labels.get({ id: 1 })

// Create a new label
vikunja_labels.create({
  title: "Critical",
  description: "Critical priority issues",
  hexColor: "#ff0000"
})

// Update a label
vikunja_labels.update({
  id: 1,
  title: "High Priority",
  hexColor: "#ff6600"
})

// Delete a label
vikunja_labels.delete({ id: 1 })

// --- Label Assignment to Tasks ---

// Apply multiple labels to a task
vikunja_tasks.apply-label({
  id: 123,
  labels: [1, 2, 3]  // Apply labels with IDs 1, 2, and 3
})

// Apply a single label
vikunja_tasks.apply-label({
  id: 123,
  labels: [1]  // Apply just the "research" label
})

// Remove specific labels from a task
vikunja_tasks.remove-label({
  id: 123,
  labels: [2, 3]  // Remove labels 2 and 3, keep others
})

// List all labels on a task
vikunja_tasks.list-labels({ id: 123 })
// Returns: Task info with detailed label data including colors and descriptions
```

### Task Position & By-Index Lookup Examples

```typescript
// --- Task Position ---

// Move a task to a new position in its project's list view
// projectId and projectViewId auto-resolve from the task when omitted
vikunja_tasks.set-position({ id: 123, position: 65536 })

// Reposition within a specific view (e.g. the Kanban view)
vikunja_tasks.set-position({
  id: 123,
  position: 5,
  viewKind: "kanban"  // resolves the project's first Kanban view
})

// Explicit projectId/projectViewId skip auto-resolution entirely
vikunja_tasks.set-position({
  id: 123,
  position: 5,
  projectId: 5,
  projectViewId: 10
})

// --- By-Index Lookup ---

// Resolve a task by its human-facing per-project index (e.g. "PROJ-42")
vikunja_tasks.get-by-index({ projectId: 5, index: 42 })
// Note: indexes are reassigned when a task moves between projects — use the
// returned task's `id` for long-lived references, not the index

// --- Cross-Project Listing (direct REST GET /tasks) ---

// Lists across every accessible project now call GET /tasks in one request
// (falling back to per-project aggregation only if that call fails)
vikunja_tasks.list({ allProjects: true, filter: "priority >= 3" })

// Documented GET /tasks params forwarded for cross-project listing
vikunja_tasks.list({
  allProjects: true,
  sort: "priority",
  orderBy: "desc",
  filterIncludeNulls: true,
  expand: ["subtasks", "comments"]
})
```

### Team Management Examples

```typescript
// List all teams
vikunja_teams.list()

// Search for teams
vikunja_teams.list({
  search: "frontend",
  page: 1,
  perPage: 10
})

// Create a new team
vikunja_teams.create({
  name: "Frontend Team",
  description: "Responsible for UI/UX development"
})

// Delete a team
vikunja_teams.delete({ id: 1 })

// Note: get, update, and members operations are not yet
// implemented in the node-vikunja library
```

### User Management Examples

> ⚠️ **Known Issue**: User endpoints may fail with authentication errors even when using valid tokens. This is a known Vikunja API issue. The MCP server will provide helpful error messages when this occurs. If you encounter this issue, please contact your Vikunja server administrator.

```typescript
// Get current user information
vikunja_users.current()

// Search for users
vikunja_users.search({
  search: "john"
})

// Get current user settings
vikunja_users.settings()

// Update user settings
vikunja_users.update-settings({
  name: "John Doe",
  language: "en",
  timezone: "America/New_York",
  weekStart: 1  // Monday
})

// Update notification preferences
vikunja_users.update-settings({
  emailRemindersEnabled: true,  // Enable email reminders for tasks
  overdueTasksRemindersEnabled: true,  // Enable daily overdue task emails
  overdueTasksRemindersTime: "09:00"  // Time to send overdue task summary
})
```

### Webhook Management Examples

```typescript
// List all available webhook events
vikunja_webhooks.list-events()
// Returns: ["task.created", "task.updated", "task.deleted", "task.assigned", ...]

// List webhooks for a project
vikunja_webhooks.list({ projectId: 1 })

// Create a webhook for task events
vikunja_webhooks.create({
  projectId: 1,
  targetUrl: "https://example.com/webhook",
  events: ["task.created", "task.updated"],
  secret: "my-secret-key"  // Optional, for HMAC signing
})

// Create a webhook without secret
vikunja_webhooks.create({
  projectId: 1,
  targetUrl: "https://example.com/notifications",
  events: ["task.assigned", "task.comment.created"]
})

// Get a specific webhook
vikunja_webhooks.get({
  projectId: 1,
  webhookId: 123
})

// Update webhook events
vikunja_webhooks.update({
  projectId: 1,
  webhookId: 123,
  events: ["task.created", "task.updated", "task.deleted"]
})

// Delete a webhook
vikunja_webhooks.delete({
  projectId: 1,
  webhookId: 123
})
```

### Advanced Filtering Examples

```typescript
// Create a real, server-side saved filter for high priority tasks
vikunja_filters.create({
  title: "High Priority Tasks",
  description: "All undone tasks with priority 4 or 5",
  filter: "done = false && priority >= 4",
  isFavorite: true
})
// The DSL's camelCase fields (e.g. dueDate) are parsed, validated, and
// translated to Vikunja's snake_case Task fields (e.g. due_date) before
// being sent to the server.

// Alternative: build the filter from structured conditions instead of a string
vikunja_filters.create({
  title: "Urgent & Incomplete",
  conditions: [
    { field: "priority", operator: ">=", value: 3 },
    { field: "done", operator: "=", value: false }
  ],
  groupOperator: "&&"
})

// List saved filters. Vikunja has no dedicated list-all endpoint, so this
// derives its results from GET /projects' pseudo-project entries (negative
// ids) and verifies each one against GET /filters/{id}.
vikunja_filters.list()

// Only filters currently marked as favorite
vikunja_filters.list({ favorite: true })

// Get a specific filter by its real numeric id (not a pseudo-project id)
vikunja_filters.get({ id: 3 })

// Build a filter string programmatically without touching the server
vikunja_filters.build({
  conditions: [
    { field: "done", operator: "=", value: false },
    { field: "priority", operator: ">=", value: 3 },
    { field: "assignees", operator: "in", value: ["user1", "user2"] }
  ],
  groupOperator: "&&"
})
// Returns: { filter: "(done = false && priority >= 3 && assignees in user1, user2)", valid: true }

// Update an existing filter. POST /filters/{id} replaces the whole
// resource, so the tool fetches the current filter first and carries
// forward any field you don't supply here.
vikunja_filters.update({
  id: 3,
  title: "Critical Tasks",
  filter: "done = false && priority = 5"
})

// Delete a saved filter
vikunja_filters.delete({ id: 3 })

// Validate a filter string without touching the server
vikunja_filters.validate({
  filter: "done = false && priority >= 3"
})
// Returns: { valid: true, errors: [] }
```

#### Filter Syntax Reference

The Vikunja filter syntax supports SQL-like queries with the following:

**Fields:**
- `done` - Task completion status (boolean)
- `priority` - Task priority (1-5)
- `percentDone` - Completion percentage (0-100)
- `dueDate` - Task due date
- `assignees` - Task assignees
- `labels` - Associated labels
- `created` - Task creation time
- `updated` - Task update time

**Operators:**
- Comparison: `=`, `!=`, `>`, `>=`, `<`, `<=`
- Pattern matching: `like` (uses `%` wildcard)
- List matching: `in`, `not in`

**Date Math:**
- `now` - Current time
- `now+24h` - 24 hours from now
- `now-7d` - 7 days ago
- `now/d` - Start of current day
- Supports: s (seconds), m (minutes), h (hours), d (days), w (weeks), M (months), y (years)

**Examples:**
- `priority = 4`
- `dueDate < now`
- `done = false && priority >= 3`
- `assignees in user1, user2`
- `dueDate >= now && dueDate < now+7d`
- `title like "%urgent%"`

**Smart Hybrid Filtering:** This MCP server implements an intelligent hybrid filtering approach that combines server-side and client-side filtering for optimal performance and reliability:
- **Primary**: Attempts server-side filtering first for maximum performance
- **Fallback**: Falls back to client-side filtering if server-side filtering fails or is unavailable
- **Transparent**: Same filter syntax works regardless of which method is used
- **Optimized**: Includes memory protection with pagination limits to prevent unbounded loading
- **Metadata**: Response includes filtering method used (`serverSideFiltering` or `clientSideFiltering`)
- **Performance**: Server-side filtering significantly reduces network traffic and processing time

## Response Format

All operations in the Vikunja MCP server follow a standardized response format for consistency and predictability:

```typescript
interface StandardResponse {
  success: boolean;
  operation: string;      // The operation performed (e.g., 'create', 'update', 'list')
  message?: string;       // Human-readable description of the result
  data?: any;            // The primary data returned (task, project, label, etc.)
  metadata?: {
    timestamp: string;    // ISO 8601 timestamp of the operation
    [key: string]: any;  // Additional operation-specific metadata
  };
}
```

### Response Examples

**Success:**
```json
{
  "success": true,
  "operation": "create",
  "message": "Task created successfully",
  "data": { "id": 123, "title": "Complete documentation" },
  "metadata": { "timestamp": "2025-05-25T12:00:00Z" }
}
```

**Error:**
```json
{
  "success": false,
  "operation": "update",
  "message": "Task not found",
  "error": { "code": "TASK_NOT_FOUND", "details": "No task exists with ID 999" }
}
```

This standardized format ensures:
- **Consistency**: All tools return responses in the same structure
- **Predictability**: Clients always know what fields to expect
- **Debugging**: Metadata provides context for troubleshooting
- **Error Handling**: Clear error information with codes and messages

## Available Tools

### Authentication
- `vikunja_auth` - Authentication management
  - `connect` - Initialize connection with API token
  - `status` - Check authentication status
  - `refresh` - Report token-refresh status: API tokens (`tk_*`) are long-lived and need no refresh; JWTs expire and must be replaced by reconnecting with a new token (Vikunja's token-refresh endpoint relies on a login cookie this server does not hold)

### Task Management ✅
- `vikunja_tasks` - Task operations (fully implemented)
  - `list` - List tasks with filters
    - Filter by project or get all tasks
    - Support for pagination, search, sorting
    - Filter by completion status
    - Apply saved filters with `filterId` parameter
    - Cross-project listing (no `projectId`, or `allProjects: true`) calls the
      documented `GET /tasks` endpoint directly (one call), falling back to
      per-project aggregation only if that call fails
    - `orderBy` (`'asc' | 'desc'`), `filterTimezone`, `filterIncludeNulls`,
      and `expand` (`'subtasks' | 'buckets' | 'reactions' | 'comments'`, can
      be repeated) are forwarded to `GET /tasks` for cross-project listing
  - `create` - Create a new task
    - Required: title, projectId
    - Optional: description, dueDate, priority, labels, assignees
    - Validates date format (ISO 8601) and IDs
  - `get` - Get task details by ID
  - `update` - Update existing task
    - Supports partial updates (GET + merge before POST — Vikunja replaces the full model)
    - Can update title, description, dueDate, priority, done status
    - Can move tasks between projects with `projectId` (verified after update)
    - Can update labels and assignees (uses efficient diff-based approach)
  - `delete` - Delete a task by ID
  - `assign` - Bulk assign users to tasks
  - `unassign` - Remove users from tasks
  - `list-assignees` - List a task's assignees via the dedicated `GET /tasks/{taskID}/assignees` endpoint
    - Optional: `search` (username search, `s` query param), `page`, `perPage`
  - `comment` - List or add comments to tasks
  - `bulk-update` - Update multiple tasks at once
    - Required: taskIds array, field name, value
    - Supported fields: done, priority, due_date, project_id, assignees, labels
    - Validates field types and values
    - Uses per-task fetch+merge+update (does not call Vikunja's native bulk API, which can wipe omitted fields — see #46)
    - ⚠️ Performance: O(n) get+update calls (n = number of tasks)
  - `bulk-delete` - Delete multiple tasks at once
    - Required: taskIds array
    - Returns deleted task details for confirmation
    - Handles partial failures gracefully
    - ⚠️ Performance: Makes individual delete calls for each task
    - Recommended: Process in batches of 20 or fewer tasks
  - `attach` - Upload a file attachment to a task (`filePath` or base64 `fileContent`)
  - `list-attachments` - List a task's attachments (file name, size, mime, created, author), with optional `page`/`perPage`
  - `get-attachment-info` - Get metadata for one attachment by `attachmentId` (derived from the list response — there is no dedicated single-attachment metadata endpoint)
  - `delete-attachment` - Delete an attachment by `attachmentId`
  - `download-attachment` - **Cannot deliver the file itself** — MCP has no binary content channel. Returns the direct download URL (optionally with a `previewSize` of `sm`/`md`/`lg`/`xl`) plus the `Authorization: Bearer <token>` header guidance needed to fetch it yourself.
  - `set-bucket` - Move a task into a Kanban bucket; `projectId`/`viewId` auto-resolve when omitted
  - `set-position` - Update a task's ordering within a project view (`position` is a float — see the Vikunja docs on inserting between two existing positions)
    - `projectId` auto-resolves from the task, `projectViewId` auto-resolves to the project's first view of `viewKind` (default `'list'`) when omitted
  - `get-by-index` - Look up a task by its human-facing per-project index (e.g. the `42` in `PROJ-42`)
    - Required: `projectId`, `index`
    - Task indexes are reassigned when a task moves between projects — use the returned task's `id` for long-lived references

### Batch Import ✅
- `vikunja_batch_import` - Import multiple tasks from CSV or JSON (fully implemented)
  - Required: projectId, format ('csv' or 'json'), data
  - Optional: skipErrors (continue on errors), dryRun (validate only)
  - **Batch Size Limit**: Maximum 100 tasks per import
  - **CSV Format**:
    - Requires header row with field names
    - Supports quoted values and escaped quotes
    - Fields: title, description, priority, dueDate, labels, assignees
    - Labels and assignees as semicolon-separated values (semicolons used to avoid conflicts with CSV commas)
  - **JSON Format**:
    - Array of task objects
    - Same fields as CSV, plus direct support for arrays
  - **Features**:
    - Automatic label lookup by name
    - Automatic user lookup by username
    - Validation before creation
    - Detailed error reporting
    - Dry run mode for testing
    - Skip errors option for partial imports

### Project Management ✅
- `vikunja_projects` - Project operations (fully implemented)
  - `list` - List all projects with filters
    - Support for pagination and search
    - Filter by archived status
  - `get` - Get project details by ID
  - `create` - Create new project
    - Required: title
    - Optional: description, parentProjectId, isArchived, hexColor (format: #RRGGBB)
    - Validates parent project hierarchy depth (max 10 levels)
  - `update` - Update existing project
    - Supports partial updates (fetches current project and merges; omitted fields are preserved)
    - Can update all project fields including hexColor (format: #RRGGBB)
    - Omitting `parentProjectId` leaves the current parent unchanged (use `move` to reparent or detach)
    - Validates parent project hierarchy depth when changing parent
  - `delete` - Delete a project by ID
  - `archive` - Archive a project
  - `unarchive` - Unarchive a project
  - **Hierarchy Management** (New!)
    - `get-children` - List direct children of a project
    - `get-tree` - Get complete project hierarchy as a tree
    - `get-breadcrumb` - Get path from root to a project
    - `move` - Move a project to a new parent
      - Validates against circular references
      - Enforces maximum depth of 10 levels
  - **Project Sharing — link shares** (anonymous/password links)
    - `create-share` - Create share link with permissions
    - `list-shares` - List all shares for a project
    - `get-share` - Get share details
    - `delete-share` - Remove a share link
    - `auth-share` - Authenticate to access a shared project
  - **Project Views**
    - `list-views` - List a project's views (list, gantt, table, kanban)
    - `get-view` - Get a single view by id
    - `create-view` - Create a new view
    - `update-view` - Update a view (fetches current view and merges; omitted fields are preserved)
    - `delete-view` - Delete a view
    - `set-done-bucket` - Composite: set a Kanban view's done bucket (resolves the view, updates it, and verifies the change took effect)
  - **Kanban Buckets**
    - `list-buckets` - List the Kanban buckets (columns) of a project
    - `create-bucket` - Create a new bucket
    - `update-bucket` - Rename/reconfigure a bucket, referenced by `bucketId` or `bucketTitle`
    - `delete-bucket` - Delete a bucket (dissociates its tasks, does not delete them), referenced by `bucketId` or `bucketTitle`
    - `list-view-tasks` - List a view's tasks in real server-side (Kanban card) order, with pagination
    - All Kanban operations auto-resolve `viewId` to the project's Kanban view when omitted
  - **Duplicate**
    - `duplicate` - Duplicate a project (tasks, files, Kanban data, assignees, comments, attachments, labels, relations, and backgrounds are copied; shares only when `duplicateShares: true`)
  - **Project Sharing — direct user & team access** (New! Wave D)
    - `share-with-user` - Composite: share with a user by **username** — resolves to an id, adds, then verifies the grant landed. Optional `atomic: true` removes the grant if verification fails (default best-effort; not a real transaction, see docs/ENDPOINT-PLAYBOOK.md §5)
    - `share-with-team` - Composite: share with a team by **name** — same resolve → add → verify shape
    - `list-members` - Read composite: direct users + direct teams + link shares for a project, in one call
    - `list-project-users` / `search-project-users` - List users with direct access, or search for one to share with
    - `add-project-user` / `update-project-user-permission` / `remove-project-user` - Primitives for fine-grained control
    - `list-project-teams` - List teams with direct access
    - `add-project-team` / `update-project-team-permission` / `remove-project-team` - Primitives for fine-grained control

### Label Management ✅
- `vikunja_labels` - Label operations (fully implemented)
  - `list` - List all labels with filters
    - Support for pagination and search
  - `get` - Get label details by ID
  - `create` - Create new label
    - Required: title
    - Optional: description, hexColor (format: #RRGGBB)
  - `update` - Update existing label
    - Supports partial updates
    - Can update title, description, hexColor
  - `delete` - Delete a label by ID
  - `apply-label` - Apply one or more labels to a task
    - Required: task id, labels array
    - Supports bulk label application
  - `remove-label` - Remove one or more labels from a task
    - Required: task id, labels array
    - Supports bulk label removal
  - `list-labels` - List all labels assigned to a task
    - Required: task id
    - Returns detailed label information

### Project Templates ✅

> **⚠️ Session-only storage:** Templates are stored in memory on the MCP
> server process, not persisted to Vikunja. They are lost when the server
> restarts. Durable storage is tracked as Wave D debt.
- `vikunja_templates` - Template operations (fully implemented, session-only persistence — see warning above)
  - `create` - Create a template from existing project
    - Required: projectId, name
    - Optional: description, tags
    - Captures all project settings and tasks
  - `list` - List all available templates
    - Shows template name, tags, and author
  - `get` - Get template details by ID
  - `update` - Update template metadata
    - Can update name, description, tags
  - `delete` - Delete a template
  - `instantiate` - Create new project from template
    - Required: id (template ID), projectName
    - Optional: parentProjectId, variables
    - Supports variable substitution:
      - `{{PROJECT_NAME}}` - The new project name
      - `{{TODAY}}` - Current date (YYYY-MM-DD)
      - `{{NOW}}` - Current timestamp
      - Custom variables via the variables parameter
    - Creates all tasks with labels from template

### Team Management ✅
- `vikunja_teams` - Team operations (fully implemented via direct REST calls where node-vikunja has no client method)
  - `list` - List all teams with filters
    - Support for pagination and search
  - `create` - Create new team
    - Required: name
    - Optional: description
  - `get` - Get a team by ID
  - `update` - Update a team's name/description
    - Required: id
    - Optional: name, description (at least one required)
  - `delete` - Delete a team by ID
  - `members` - Manage team membership (keyed by **username**, not numeric user id — this is deliberate on Vikunja's part to prevent automated/enumerated user-id entry)
    - `list` - List a team's members (read from the team's embedded `members` array; there is no standalone list-members endpoint)
    - `add` - Add a member by username
      - Required: username
      - Optional: admin (initial admin flag)
    - `remove` - Remove a member by username
      - Required: username
    - `toggleAdmin` - **Toggles** a member's admin status (the API endpoint takes no body and always flips the current value; it cannot set an explicit true/false)
      - Required: username

### User Management ✅
- `vikunja_users` - User operations (fully implemented) **[Requires JWT authentication]**
  - `current` - Get current authenticated user info
  - `search` - Search for users
    - Optional: search query, pagination
  - `settings` - Get current user settings
  - `update-settings` - Update user settings
    - Optional: name, language, timezone, weekStart, frontendSettings
  - **Note:** User operations require JWT authentication. When using API token authentication, these tools will not be available.

### Webhook Management ✅
- `vikunja_webhooks` - Webhook operations for project automation (fully implemented)
  - `list-events` - Get all available webhook event types
  - `list` - List webhooks for a project
    - Required: projectId
  - `get` - Get a specific webhook
    - Required: projectId, webhookId
  - `create` - Create a new webhook
    - Required: projectId, targetUrl, events (array)
    - Optional: secret (for HMAC signing)
    - **Note**: Events are validated against available event types
  - `update` - Update webhook events
    - Required: projectId, webhookId, events (array)
    - **Note**: Events are validated against available event types
  - `delete` - Delete a webhook
    - Required: projectId, webhookId
  
  **Event Validation**: When creating or updating webhooks, the provided events are automatically validated against the list of available events from the API. Invalid events will result in a clear error message showing which events are invalid and listing all valid options. Valid events are cached for 5 minutes to improve performance.

### Notifications ✅
- `vikunja_notifications` - Manage the current user's Vikunja notifications
  - `list` - List notifications
    - Optional: `unreadOnly` (client-side filter — the API has no server-side unread filter), `page`, `perPage`
    - Each notification may include a best-effort `relatedTask` field (`{id, title}`) when the API's payload happens to embed one — this is a convenience extraction, not a documented API guarantee
  - `mark-read` - Mark a single notification as read
    - Required: `notificationId`
    - **Idempotent**: the underlying `POST /notifications/{id}` endpoint is a pure toggle (no request body to pick read vs. unread); this tool checks the result and toggles a second time if needed so calling it repeatedly always leaves the notification read
  - `mark-all-read` - Mark every notification as read in one call
  - **Note**: link shares cannot have notifications (per the API); this tool requires a full user session

### Subscriptions ✅
- `vikunja_subscriptions` - Subscribe/unsubscribe the current user to/from notifications for a project or task
  - `subscribe` - Subscribe to an entity
    - Required: `entity` (`project` or `task`), `entityId`
  - `unsubscribe` - Unsubscribe from an entity
    - Required: `entity`, `entityId`
    - **Idempotent**: unsubscribing from something you're not subscribed to succeeds as a no-op (the API's 404 "subscription does not exist" is treated as success, not an error)

### Reactions ✅
- `vikunja_reactions` - Add, remove, or list emoji/text reactions on a task or task comment
  - `list` - List all reactions for an entity
    - Required: `kind` (`tasks` or `comments`), `entityId`
  - `add` - Add a reaction
    - Required: `kind`, `entityId`, `value` (any UTF character or short text, up to 20 characters)
  - `remove` - Remove your own reaction
    - Required: `kind`, `entityId`, `value`

### Filter Management ✅

> **Real, server-side saved filters:** `create`/`get`/`update`/`delete` call
> Vikunja's actual `/filters` API (`PUT /filters`, `GET`/`POST`/`DELETE
> /filters/{id}`) — filters persist on the server, survive an MCP restart,
> and are visible in the Vikunja UI and to other clients. Saved filters are
> **not** project-scoped (the API has no `project_id` field on a saved
> filter); Vikunja instead exposes each one as a *pseudo-project* with a
> negative id, and `isFavorite` controls whether it also shows in the
> favorites parent alongside favorite projects. There is no dedicated
> list-all-saved-filters endpoint, so `list` derives its results from `GET
> /projects`' pseudo-project entries and verifies each one against `GET
> /filters/{id}`; entries it could not verify are still returned (title
> only) with `hydrated: false` rather than silently dropped. `build` and
> `validate` remain pure local utilities — they construct or check a filter
> query string without contacting the server.
- `vikunja_filters` - Advanced filtering for tasks, backed by Vikunja's real saved filters (fully implemented)
  - `list` - Derive the list of saved filters from `GET /projects`' pseudo-project entries
    - Optional: page, perPage, favorite (filter to favorited filters only)
  - `get` - Get a specific saved filter by its numeric id
    - Required: id
  - `create` - Create a new saved filter (`PUT /filters`)
    - Required: title, and one of filter (query string) or conditions (array)
    - Optional: description, groupOperator (&&, ||), isFavorite
  - `update` - Update an existing saved filter (`POST /filters/{id}`, a full-resource replace — omitted fields are carried forward from the current filter, not cleared)
    - Required: id
    - Optional: title, description, filter, conditions, groupOperator, isFavorite
  - `delete` - Delete a saved filter (`DELETE /filters/{id}`)
    - Required: id
  - `build` - Build a filter string from conditions (local utility, no server call)
    - Required: conditions array
    - Optional: groupOperator (&&, ||)
  - `validate` - Validate a filter string (local utility, no server call)

### Data Export ✅

> **⚠️ WARNING: Memory Usage**  
> Export operations load entire project hierarchies into memory. For very large projects with thousands of tasks or deeply nested structures, this may consume significant memory. Consider exporting smaller projects individually.
- `vikunja_export_project` - Export project data **[Requires JWT authentication]**
  - **Parameters:**
    - `projectId` (required) - ID of the project to export
    - `includeChildren` (optional) - Include child projects recursively (default: false)
  - **Returns:** Complete project data including tasks, labels, and metadata
  - **Features:**
    - Exports all tasks with full details
    - Includes all labels used in the project
    - Optionally includes complete child project hierarchy
    - Circular reference detection for nested projects
    - Export metadata includes timestamp and version
  - **Note:** Export operations require JWT authentication. When using API token authentication, this tool will not be available.
  
- `vikunja_request_user_export` - Request full user data export
  - **Parameters:**
    - `password` (required) - User password for security verification
  - **Returns:** Confirmation that export has been requested
  - **Note:** You will receive an email when the export is ready
  
- `vikunja_download_user_export` - Confirm a previously requested user data export is ready on the server
  - **Parameters:**
    - `password` (required) - User password for security verification
  - **Returns:** The server's confirmation message (`models.Message`), not the export file
  - **Note:** Export must be requested first via `vikunja_request_user_export`. Per the Vikunja API spec, this endpoint never returns the export archive's contents, and the MCP protocol has no binary-attachment support — retrieve the actual exported file from the Vikunja web UI or a direct API client using the same credentials.




## Known Limitations

1. **File Attachments**: Upload (`attach`), list (`list-attachments`), metadata (`get-attachment-info`), and delete (`delete-attachment`) are implemented. `download-attachment` cannot deliver the file's bytes — the Vikunja API returns raw `application/octet-stream` for downloads, and MCP has no binary content channel — so it returns the direct download URL and auth guidance for the caller to fetch it themselves instead.
2. **Team Operations**: node-vikunja only implements list/create/delete for teams, so get/update/members go through direct REST calls (see `src/utils/vikunja-rest.ts`). The admin-toggle member operation is a true toggle server-side — it cannot set an explicit admin value in one call.
3. **Pagination**: Some endpoints may not fully support pagination parameters due to API limitations
4. **Authentication Issues**: Some Vikunja API endpoints have known authentication issues:
   - **User endpoints**: May fail with token errors even with valid tokens (known Vikunja API limitation)
   - **Bulk operations**: May have authentication issues with certain Vikunja API versions
   - **Label operations**: May fail with authentication errors on some server configurations
   - **Assignee operations**: May fail with authentication errors when creating/updating tasks with assignees
   - The server provides detailed error messages when these issues occur, suggesting workarounds

## Security & Performance Features

### Security Enhancements
- **Zod Schema Validation**: Enterprise-grade input validation with comprehensive type checking
- **DoS Protection**: Input sanitization, length limits, and character allowlisting
- **Credential Protection**: Automatic masking of sensitive tokens and URLs in logs and error messages
- **Entity Resolution Service**: Robust label and user mapping with defensive error handling for malformed API responses
- **Rate Limiting**: Configurable request rate limits and payload size restrictions to prevent DoS attacks
- **Memory Protection**: Pagination limits and memory usage monitoring to prevent resource exhaustion
- **Error Handling**: Structured error responses that avoid exposing sensitive system information

### Performance Optimizations
- **Hybrid Filtering**: Smart server-side filtering with client-side fallback for optimal performance
- **Connection Pooling**: Efficient session management with automatic client caching
- **Request Batching**: Optimized bulk operations with efficient diff-based updates
- **Memory Management**: Automatic cleanup and pagination to handle large datasets safely
- **Thread-Safe Client Management**: Async-only ClientContext API eliminates race conditions in concurrent scenarios
- **Opossum Circuit Breaker**: Production-ready retry logic with automatic failure detection and recovery
- **Simplified Storage**: In-memory filter storage with 90% reduced complexity and overhead

## Configuration

### Environment Variables

The server supports various configuration options through environment variables:

#### Basic Configuration
```bash
# Vikunja instance URL (required)
VIKUNJA_URL=https://your-vikunja-instance.com/api/v1

# Authentication token (required)
VIKUNJA_API_TOKEN=your-api-token

# Enable debug logging (default: false)
DEBUG=true

# Set log level (error, warn, info, debug)
LOG_LEVEL=debug
```

#### Security & Performance Configuration
```bash
# Rate limiting (default: enabled)
RATE_LIMIT_ENABLED=true
RATE_LIMIT_PER_MINUTE=60        # Requests per minute (default: 60)
RATE_LIMIT_PER_HOUR=1000        # Requests per hour (default: 1000)

# Request size limits (default: 1MB)
MAX_REQUEST_SIZE=1048576        # Maximum request payload size in bytes
MAX_RESPONSE_SIZE=10485760      # Maximum response size in bytes (default: 10MB)

# Execution timeout (default: 30 seconds)
EXECUTION_TIMEOUT=30000         # Tool execution timeout in milliseconds

# Memory protection (default: enabled)
MEMORY_PROTECTION_ENABLED=true
MAX_TASKS_PER_REQUEST=1000      # Maximum tasks to load per request

# Circuit breaker configuration (opossum)
CIRCUIT_BREAKER_ENABLED=true    # Enable circuit breaker for API calls
CIRCUIT_BREAKER_TIMEOUT=60000   # Circuit breaker timeout in milliseconds (default: 60s)
CIRCUIT_BREAKER_ERRORS_THROTTLE=10 # Errors before opening circuit (default: 10)
CIRCUIT_BREAKER_RESET_TIMEOUT=30000 # Time to wait before trying half-open state (default: 30s)

# Filter security (Zod validation)
FILTER_MAX_LENGTH=1000          # Maximum filter string length (default: 1000)
FILTER_MAX_VALUE_LENGTH=200     # Maximum individual value length (default: 200)
```

For detailed rate limiting configuration, see [`docs/RATE_LIMITING.md`](docs/RATE_LIMITING.md).

#### Module Gating & Secrets

Individual tool modules (tasks, projects, labels, teams, users, webhooks, filters,
templates, export, batch-import) can be enabled/disabled via an optional
`vikunja-mcp.config.json` file and/or `VIKUNJA_MCP_MODULE_*` environment variables
(env always wins). Sensitive variables like `VIKUNJA_API_TOKEN` also support a
`VIKUNJA_API_TOKEN_FILE` variant for Docker/Swarm secrets. See
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for the full reference, defaults,
and a Docker Swarm example.

## Roadmap

- [x] ✅ **Security hardening** - Comprehensive vulnerability fixes implemented
- [x] ✅ **Performance optimization** - Hybrid filtering and memory protection
- [x] ✅ **Error handling** - Centralized error utilities and structured responses
- [x] ✅ **Test coverage** - 98.91% function coverage achieved
- [x] ✅ **Architecture simplification** - 90% code reduction with enhanced maintainability
- [x] ✅ **Production-ready resilience** - Opossum circuit breaker and Zod validation
- [ ] Add webhook subscriptions for real-time updates
- [ ] Add caching for frequently accessed data
- [ ] Add integration tests with real Vikunja instance
- [ ] Implement persistent storage for saved filters (optional - in-memory works well)

## Contributing

Development workflow and PR requirements are documented in [CLAUDE.md](CLAUDE.md).

## License

MIT
