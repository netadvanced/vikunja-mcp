/**
 * AUTO-GENERATED — do not edit by hand.
 *
 * Generated from docs/vikunja-openapi-v2.json (OpenAPI 3.x -> TS)
 * via `npm run generate:api-types:v2`. See docs/API-SPEC.md for the refresh
 * procedure.
 *
 * NOT YET WIRED INTO RUNTIME: this is spec/type groundwork for the v2 API
 * (tracking issue #28, item vendor-v2-spec-types). No src/ code imports from
 * this file yet.
 */

export interface paths {
    "/admin/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin overview
         * @description Returns per-instance counts (users, projects, tasks, teams, shares) plus the current license snapshot. Restricted to instance admins on a licensed instance; unlicensed or non-admin callers get a 404, making the endpoint indistinguishable from one that is not registered.
         */
        get: operations["admin-overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List all projects (admin)
         * @description Returns every project on the instance, including archived ones and projects the caller does not own. Restricted to instance admins on a licensed instance; unlicensed or non-admin callers get a 404, making the endpoint indistinguishable from one that is not registered.
         */
        get: operations["admin-projects-list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/projects/{id}/owner": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Reassign a project's owner (admin)
         * @description Reassigns a project to a new owner — the admin-only escape hatch the regular update endpoint does not allow. The new owner must be an active account that is not scheduled for deletion. Restricted to instance admins on a licensed instance.
         */
        patch: operations["admin-projects-patch-owner"];
        trace?: never;
    };
    "/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a user (admin)
         * @description Creates a local user account, bypassing the public-registration toggle. Honours the admin-only is_admin and skip_email_confirm fields. Restricted to instance admins on a licensed instance.
         */
        post: operations["admin-users-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a user (admin)
         * @description Deletes a user. With mode=now the user is removed immediately. With mode=scheduled (the default) the user is scheduled for deletion through the email-confirmation self-deletion flow. Deleting the last remaining admin is refused with 400.
         */
        delete: operations["admin-users-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}/admin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Promote or demote a user (admin)
         * @description Sets a user's instance-admin flag. The body field is a pointer: omitting is_admin leaves the flag unchanged. Demoting the last remaining admin is refused with 400.
         */
        patch: operations["admin-users-patch-admin"];
        trace?: never;
    };
    "/admin/users/{id}/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Set a user's password (admin)
         * @description Sets a new password for a local account without requiring the current one, then invalidates all of the user's sessions. Accounts managed by a third-party authentication provider are refused with 412.
         */
        patch: operations["admin-users-set-password"];
        trace?: never;
    };
    "/admin/users/{id}/password-reset-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a password-reset email (admin)
         * @description Triggers the self-service password-reset email for a local account. Refused with 412 when no mailer is configured or when the account is managed by a third-party authentication provider.
         */
        post: operations["admin-users-password-reset-email"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Set a user's status (admin)
         * @description Changes a user's account status without requiring them to log in. The body field is a pointer: omitting status leaves it unchanged. Moving the last remaining admin out of Active is refused with 400.
         */
        patch: operations["admin-users-patch-status"];
        trace?: never;
    };
    "/avatar/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a user's avatar
         * @description Returns the user's avatar as raw image bytes. The Content-Type is chosen at runtime by the user's avatar provider (gravatar, initials, marble, an uploaded image, or the default placeholder). An unknown username is not an error — the default placeholder avatar is returned. Authenticated like every other endpoint.
         */
        get: operations["avatar-get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/filters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a saved filter
         * @description Creates a saved filter; the authenticated user becomes its owner. The filter query is validated before it is stored.
         */
        post: operations["filters-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/filters/{filter}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a saved filter
         * @description Returns a single saved filter. Only the owner may see it. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified.
         */
        get: operations["filters-read"];
        /**
         * Update a saved filter
         * @description Replaces all of a saved filter's fields — only the owner may update it. Use PATCH for a partial update.
         */
        put: operations["filters-update"];
        post?: never;
        /**
         * Delete a saved filter
         * @description Deletes a saved filter. Only the owner may delete it.
         */
        delete: operations["filters-delete"];
        options?: never;
        head?: never;
        /**
         * Update a saved filter (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-filters-read"];
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Healthcheck
         * @description Reports whether the service and its dependencies (database, Redis if enabled) are reachable. Returns 200 with status "OK" when healthy, 500 otherwise. When OpenID Connect providers are configured, each provider's availability is reported too; an unavailable provider (typically because it was unreachable while Vikunja started) degrades the status but never fails the check, since initialization is retried automatically (with exponential backoff, after at most 15 minutes) and a restart would not help. Public — no authentication required.
         */
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Instance info
         * @description Returns version, frontend URL, motd and the enabled features of this Vikunja instance. Public — no authentication required.
         */
        get: operations["info"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List labels
         * @description Returns the labels visible to the authenticated user — their own plus any used on tasks they can access. Not a global list.
         */
        get: operations["labels-list"];
        put?: never;
        /**
         * Create a label
         * @description Creates a label; the authenticated user becomes its owner.
         */
        post: operations["labels-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/labels/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a label
         * @description Returns a single label. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified.
         */
        get: operations["labels-read"];
        /**
         * Update a label
         * @description Replaces all of a label's fields — only the owner may update it. Use PATCH for a partial update.
         */
        put: operations["labels-update"];
        post?: never;
        /**
         * Delete a label
         * @description Deletes a label. Only the owner may delete it.
         */
        delete: operations["labels-delete"];
        options?: never;
        head?: never;
        /**
         * Update a label (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-labels-read"];
        trace?: never;
    };
    "/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Login
         * @description Logs a user in with username and password (and a TOTP passcode when 2FA is enabled), returning a short-lived JWT. A long-lived refresh token is set as an HttpOnly cookie scoped to the refresh endpoint.
         */
        post: operations["auth-login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Logout
         * @description Destroys the current session server-side and clears the refresh-token cookie. A no-op for API tokens and link shares, which carry no session.
         */
        post: operations["auth-logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/csv/detect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Detect a CSV file's structure
         * @description Analyzes an uploaded CSV file and returns its detected columns, delimiter, quote character and date format, plus a suggested column-to-attribute mapping the client can edit before previewing or migrating. Read-only: nothing is imported.
         */
        post: operations["migration-csv-detect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/csv/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import a CSV file
         * @description Imports the tasks from the uploaded CSV file into Vikunja using the given config. The import runs synchronously and returns once it has finished.
         */
        post: operations["migration-csv-migrate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/csv/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Preview a CSV import
         * @description Returns the first few tasks that would be imported from the uploaded CSV file with the given config, without importing anything. Read-only.
         */
        post: operations["migration-csv-preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/csv/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the CSV migration status
         * @description Returns the migration status of the authenticated user for the CSV importer, i.e. whether and when they last imported a CSV.
         */
        get: operations["migration-csv-status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/ticktick/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Migrate from ticktick
         * @description Imports the authenticated user's data from an uploaded export file into Vikunja. Send the file under the multipart "import" field. The import runs synchronously and returns once it has finished.
         */
        post: operations["migration-ticktick-migrate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/ticktick/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the migration status for ticktick
         * @description Returns the migration status of the authenticated user for this service, i.e. whether and when they last migrated.
         */
        get: operations["migration-ticktick-status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/vikunja-file/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Migrate from vikunja-file
         * @description Imports the authenticated user's data from an uploaded export file into Vikunja. Send the file under the multipart "import" field. The import runs synchronously and returns once it has finished.
         */
        post: operations["migration-vikunja-file-migrate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/vikunja-file/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the migration status for vikunja-file
         * @description Returns the migration status of the authenticated user for this service, i.e. whether and when they last migrated.
         */
        get: operations["migration-vikunja-file-status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/wekan/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Migrate from wekan
         * @description Imports the authenticated user's data from an uploaded export file into Vikunja. Send the file under the multipart "import" field. The import runs synchronously and returns once it has finished.
         */
        post: operations["migration-wekan-migrate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/wekan/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the migration status for wekan
         * @description Returns the migration status of the authenticated user for this service, i.e. whether and when they last migrated.
         */
        get: operations["migration-wekan-status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List notifications
         * @description Returns the authenticated user's own notifications, newest first. Link shares have no notifications and are refused.
         */
        get: operations["notifications-list"];
        put?: never;
        /**
         * Mark all notifications as read
         * @description Marks every notification of the authenticated user as read. Link shares have no notifications and are refused.
         */
        post: operations["notifications-mark-all-read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications.atom": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Notifications Atom feed
         * @description Returns the authenticated user's latest notifications as an Atom feed. Authenticated with HTTP Basic auth: the username is the token owner and the password is a feeds-scoped Vikunja API token (tk_ prefix) — password and LDAP credentials are rejected because feed URLs are commonly shared or cached. Fetching the feed does not mark notifications as read.
         */
        get: operations["notifications-atom-feed"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{notificationid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Mark a notification as (un-)read
         * @description Marks one of the authenticated user's notifications as read or unread. A user can only mark their own notifications.
         */
        put: operations["notifications-mark-read"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/oauth/authorize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * OAuth 2.0 authorize endpoint
         * @description Creates a single-use authorization code for the authenticated user. PKCE (code_challenge with method S256) and a loopback or vikunja- scheme redirect_uri are required.
         */
        post: operations["oauth-authorize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/oauth/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * OAuth 2.0 token endpoint
         * @description Exchanges an authorization code (grant_type=authorization_code) or a refresh token (grant_type=refresh_token) for an access token. Accepts application/x-www-form-urlencoded per RFC 6749 as well as JSON.
         */
        post: operations["oauth-token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List projects
         * @description Returns the projects the authenticated user has access to (owned plus shared, with child projects of accessible parents), paginated. Archived projects are excluded unless is_archived=true. Pass expand=permissions to include each project's max_permission for the caller.
         */
        get: operations["projects-list"];
        put?: never;
        /**
         * Create a project
         * @description Creates a project; the authenticated user becomes its owner. When parent_project_id is set, the caller needs write access to that parent. Default views and a backlog bucket are created automatically.
         */
        post: operations["projects-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a project
         * @description Returns a single project the caller can read, including its views, the caller's favorite/subscription state and the caller's max_permission. Resolves the Favorites pseudo-project and saved-filter-backed projects. Served fresh on every call (no conditional/ETag) because the response carries user-scoped state that changes without bumping the project's updated timestamp.
         */
        get: operations["projects-read"];
        /**
         * Update a project
         * @description Replaces a project's fields. Requires write access (admin to reparent or delete). Use PATCH for a partial update.
         */
        put: operations["projects-update"];
        post?: never;
        /**
         * Delete a project
         * @description Deletes a project together with its tasks, views, buckets and child projects. Only project admins may delete it.
         */
        delete: operations["projects-delete"];
        options?: never;
        head?: never;
        /**
         * Update a project (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-projects-read"];
        trace?: never;
    };
    "/projects/{project_id}/time-entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a project's time entries
         * @description Returns the time entries for the given project — both standalone project entries and entries on tasks currently in the project — paginated. Scoped to what you can read: an inaccessible or unknown project yields an empty list, not an error.
         */
        get: operations["project-time-entries-list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectid}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duplicate a project
         * @description Deep-copies a project — its tasks, files, kanban data, assignees, comments, attachments, labels, relations and backgrounds — into a new project owned by the authenticated user. User/team/link shares are only copied when duplicate_shares is set to true. The user needs read access to the source project, plus write access to the parent project when one is given. The copy is placed under parent_project_id (top level if omitted). Returns the duplicate in duplicated_project.
         */
        post: operations["projects-duplicate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/background": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a project background
         * @description Streams a project's background image, whichever provider set it. Requires read access to the project. Always served as image/jpeg with a revalidation Last-Modified header, so a conditional If-Modified-Since request gets a 304. Returns 404 when the project has no background.
         */
        get: operations["projects-background-get"];
        put?: never;
        post?: never;
        /**
         * Remove a project background
         * @description Removes a project's background, whichever provider set it. Succeeds even when the project has no background. Requires write access to the project. Returns the updated project.
         */
        delete: operations["projects-background-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/backgrounds/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Upload a project background
         * @description Uploads an image via multipart/form-data under the "background" field and sets it as the project's background. Requires write access to the project. The image is resized server-side and stored as JPEG; it replaces any previous background (idempotent replace, hence PUT). Returns the updated project.
         */
        put: operations["projects-background-upload"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/shares": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the link shares of a project
         * @description Returns the link shares of the given project, paginated. Only project admins may list them.
         */
        get: operations["shares-list"];
        put?: never;
        /**
         * Share a project via link
         * @description Creates a link share for the given project. The parent project is taken from the URL, not the body, and the authenticated user becomes the sharer. Creating an admin share requires project admin; read/write shares require write access. The hash is generated by the server; a password, if set, is write-only and cannot be read back.
         */
        post: operations["shares-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/shares/{share}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a single link share of a project
         * @description Returns one link share of a project. The share must belong to the project in the path. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified.
         */
        get: operations["shares-read"];
        put?: never;
        post?: never;
        /**
         * Remove a link share from a project
         * @description Deletes a link share of a project. The share must belong to the project in the path. Requires write access to the project.
         */
        delete: operations["shares-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tasks in a project
         * @description Returns the tasks in a project, paginated and flat. Requires read access to the project. Filtering, sorting and search apply to every variant. See https://vikunja.io/docs/filters for the filter language.
         */
        get: operations["project-tasks-list"];
        put?: never;
        /**
         * Create a task
         * @description Creates a task in the project from the URL. The authenticated user needs write access to that project and becomes the task's creator.
         */
        post: operations["tasks-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/tasks/by-index/{index}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a task by its project index
         * @description Returns a single task addressed by its per-project index. The {project} segment accepts either a numeric project id or a textual project identifier (e.g. "PROJ"); a value made solely of digits is always treated as an id. Embed extra, more expensive data in each task. Repeatable. One of: subtasks, buckets, reactions, comments, comment_count, time_entries_count, is_unread. Expanding can return more tasks than the page limit (subtasks) and inflate the response.
         */
        get: operations["tasks-read-by-index"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/teams": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the teams a project is shared with
         * @description Returns the teams that have access to the project, each with the permission they were granted. Requires read access to the project.
         */
        get: operations["project-teams-list"];
        put?: never;
        /**
         * Share a project with a team
         * @description Gives a team access to the project at the requested permission. Only project admins may share. Fails if the team already has access.
         */
        post: operations["project-teams-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/teams/{team}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a team's permission on a project
         * @description Changes the permission a team has on the project; only the permission is writable. Only project admins may update a share.
         */
        put: operations["project-teams-update"];
        post?: never;
        /**
         * Remove a team from a project
         * @description Revokes a team's access to the project. Only project admins may remove a share.
         */
        delete: operations["project-teams-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the users a project is shared with
         * @description Returns the users that have direct access to the project, with their permission. Requires read access to the project; team shares are not included. Pass q to filter by username.
         */
        get: operations["project-users-list"];
        put?: never;
        /**
         * Share a project with a user
         * @description Grants a user access to the project. The user is named by username in the body. Only project admins may share; the project owner cannot be added.
         */
        post: operations["project-users-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/users/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search users with access to a project
         * @description Returns the users who can access the project — through ownership, a direct share or a team — optionally filtered by a search string. Intended for share autocomplete. Requires read access to the project.
         */
        get: operations["projects-users-search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/users/{user}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a user's permission on a project
         * @description Changes the permission a user has on the project; only the permission field is updated. The user is identified by username in the path. Only project admins may update a share.
         */
        put: operations["project-users-update"];
        post?: never;
        /**
         * Remove a user's access to a project
         * @description Revokes a user's direct access to the project, identified by username in the path. Only project admins may do this.
         */
        delete: operations["project-users-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/views": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the views of a project
         * @description Returns all views of the given project. Requires read access to the project; the list is not paginated by the server but is returned in the standard list envelope.
         */
        get: operations["project-views-list"];
        put?: never;
        /**
         * Create a view in a project
         * @description Creates a view in the given project. The parent project is taken from the URL, not the body. Only project admins may create a view.
         */
        post: operations["project-views-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/views/{view}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a single view of a project
         * @description Returns one view of a project. The view must belong to the project in the path. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified.
         */
        get: operations["project-views-read"];
        /**
         * Update a view of a project
         * @description Replaces a project view's fields. The view must belong to the project in the path, and only project admins may update it. Use PATCH for a partial update.
         */
        put: operations["project-views-update"];
        post?: never;
        /**
         * Delete a view of a project
         * @description Deletes a project view along with its buckets and task positions. Only project admins may delete it.
         */
        delete: operations["project-views-delete"];
        options?: never;
        head?: never;
        /**
         * Update a view of a project (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-project-views-read"];
        trace?: never;
    };
    "/projects/{project}/views/{view}/buckets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the buckets of a kanban view
         * @description Returns all kanban buckets of a project view, ordered by position. Requires read access to the project. The list is not paginated by the server but is returned in the standard list envelope. To get the buckets together with their tasks, use the buckets/tasks endpoint instead.
         */
        get: operations["buckets-list"];
        put?: never;
        /**
         * Create a bucket in a kanban view
         * @description Creates a kanban bucket in the given project view. The project and view come from the URL, not the body. Requires write access to the project.
         */
        post: operations["buckets-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/views/{view}/buckets/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a kanban view's buckets with their tasks
         * @description Returns the buckets of a project's kanban view, each populated with the tasks in it. Requires read access to the project. Not paginated: the number and size of buckets follow the view's bucket configuration, so page/per_page do not apply. Filtering, sorting and search apply to every variant. See https://vikunja.io/docs/filters for the filter language.
         */
        get: operations["project-view-buckets-tasks-list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/views/{view}/buckets/{bucket}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a bucket of a kanban view
         * @description Replaces a kanban bucket's title, limit and position. The bucket is identified by the URL, which also scopes it to the project and view. Requires write access to the project.
         */
        put: operations["buckets-update"];
        post?: never;
        /**
         * Delete a bucket of a kanban view
         * @description Deletes a kanban bucket and moves its tasks to the view's default bucket; no tasks are deleted. You cannot delete the last bucket of a view (rejected with 412). Requires write access to the project.
         */
        delete: operations["buckets-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/views/{view}/buckets/{bucket}/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Place a task in a kanban bucket
         * @description Moves a task into the given bucket of a project's kanban view. Requires write access to the project. Idempotent: re-sending the same bucket is a no-op. Side effects: moving a task into the view's done bucket marks it done (and out of it un-marks it); a repeating task moved into the done bucket is reopened and routed back to the default bucket instead. Moving a task into a bucket that is already at its task limit is rejected with 412. A bucket that does not resolve under the project and view in the path is rejected with 404.
         */
        put: operations["task-bucket-update"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/views/{view}/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tasks in a project view
         * @description Returns the tasks in a project view, paginated and flat. The view's own filter, sort and search are applied on top of the query. Always returns flat tasks, even for a kanban view — use the buckets endpoint to get tasks grouped by bucket. Filtering, sorting and search apply to every variant. See https://vikunja.io/docs/filters for the filter language.
         */
        get: operations["project-view-tasks-list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a project's webhooks
         * @description Returns the webhook targets configured for the given project, paginated. Requires read access to the project. Secret and basic-auth credentials are never included.
         */
        get: operations["webhooks-list"];
        put?: never;
        /**
         * Create a webhook target in a project
         * @description Creates a webhook target that receives POST requests about the subscribed events of the given project. The parent project is taken from the URL, not the body. Requires write access to the project. The secret and basic-auth credentials are write-only and not returned in the response.
         */
        post: operations["webhooks-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/webhooks/{webhook}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a webhook target's events
         * @description Changes the events a webhook target subscribes to. Only the events list can be changed; target_url, secret and auth are immutable after creation. The webhook must belong to the project in the path, and write access to that project is required.
         */
        put: operations["webhooks-update"];
        post?: never;
        /**
         * Delete a webhook target
         * @description Deletes a webhook target. The webhook must belong to the project in the path, and write access to that project is required.
         */
        delete: operations["webhooks-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List API token routes
         * @description Returns every API route available to scope an API token against, grouped by resource and permission. Covers both /api/v1 and /api/v2 routes.
         */
        get: operations["token-routes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shares/{share}/auth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Get an auth token for a link share
         * @description Exchanges a link share's public hash (and password, for password-protected shares) for a JWT auth token scoped to the shared project.
         */
        post: operations["auth-link-share"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/subscriptions/{entity}/{entityID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Subscribe to an entity
         * @description Subscribes the authenticated user to a project or task so they receive its notifications. The user needs read access to the entity. Fails if a subscription already exists.
         */
        post: operations["subscriptions-create"];
        /**
         * Unsubscribe from an entity
         * @description Removes the authenticated user's own subscription to a project or task. Only affects the caller's subscription, not other users'.
         */
        delete: operations["subscriptions-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tasks across all projects
         * @description Returns the tasks the authenticated user can see across every project they have access to, paginated and flat. Filtering, sorting and search apply to every variant. See https://vikunja.io/docs/filters for the filter language.
         */
        get: operations["tasks-list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Bulk update tasks
         * @description Applies the fields named in `fields` from `values` to every task in `task_ids`. The user needs write access to every project the involved tasks belong to; if write is missing on even one, the whole request is rejected and nothing is changed. Returns the updated tasks.
         */
        put: operations["tasks-bulk-update"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{projecttask}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a task
         * @description Returns a single task by its numeric id. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified. Embed extra, more expensive data in each task. Repeatable. One of: subtasks, buckets, reactions, comments, comment_count, time_entries_count, is_unread. Expanding can return more tasks than the page limit (subtasks) and inflate the response.
         */
        get: operations["tasks-read"];
        /**
         * Update a task
         * @description Replaces all of a task's fields; requires write access. Setting project_id to a different project moves the task and also requires write access to the target project. Use PATCH for a partial update.
         */
        put: operations["tasks-update"];
        post?: never;
        /**
         * Delete a task
         * @description Deletes a task. Requires write access to its project.
         */
        delete: operations["tasks-delete"];
        options?: never;
        head?: never;
        /**
         * Update a task (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-tasks-read"];
        trace?: never;
    };
    "/tasks/{projecttask}/assignees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the assignees of a task
         * @description Returns the users assigned to the given task, paginated. Requires read access to the task. Pass q to filter assignees by username.
         */
        get: operations["task-assignees-list"];
        put?: never;
        /**
         * Assign a user to a task
         * @description Assigns a user to the given task. The parent task is taken from the URL; the assignee is named by user_id in the body. The assignee must have access to the task's project, and the caller needs write access to the task.
         */
        post: operations["task-assignees-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{projecttask}/assignees/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Replace all assignees of a task
         * @description Replaces the task's full assignee set with the users in the body: users not in the list are unassigned, new ones are added. Pass an empty array to unassign everyone. Each assignee must have access to the task's project, and the caller needs write access to the task.
         */
        put: operations["task-assignees-bulk"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{projecttask}/assignees/{user}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove an assignee from a task
         * @description Un-assigns a user from the given task, identified by their user id in the path. Requires write access to the task.
         */
        delete: operations["task-assignees-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{projecttask}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duplicate a task
         * @description Copies a task — including its labels, assignees, attachments and reminders — into the same project, and records a "copied from" relation back to the original. The authenticated user needs read access to the source task and write access to its project. Returns the newly created duplicate.
         */
        post: operations["tasks-duplicate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{projecttask}/labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the labels on a task
         * @description Returns the labels attached to the given task, paginated. Requires read access to the task.
         */
        get: operations["task-labels-list"];
        put?: never;
        /**
         * Add a label to a task
         * @description Attaches an existing label to the given task. Requires write access to the task and access to the label. Fails if the label is already on the task.
         */
        post: operations["task-labels-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{projecttask}/labels/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Replace all labels on a task
         * @description Sets the task's labels to exactly the provided list: labels not in the list are removed, missing ones are added, unchanged ones are left alone. Requires write access to the task, and you must be able to see every label you attach. Returns the resulting label set.
         */
        put: operations["task-labels-bulk-replace"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{projecttask}/labels/{label}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a label from a task
         * @description Detaches a label from the given task. Requires write access to the task.
         */
        delete: operations["task-labels-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{projecttask}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Mark a task as read
         * @description Clears the authenticated user's unread status for a task, dismissing the unread indicator raised by mentions and other task notifications. Idempotent: marking an already-read or inaccessible task succeeds as a no-op.
         */
        put: operations["tasks-mark-read"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task_id}/time-entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a task's time entries
         * @description Returns the time entries logged against the given task, across all users, paginated. Scoped to what you can read: an inaccessible or unknown task yields an empty list, not an error.
         */
        get: operations["task-time-entries-list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a task's attachments
         * @description Returns the attachment metadata for one task, paginated. Requires read access to the task. The file bytes are not included; fetch them from the download endpoint.
         */
        get: operations["task-attachments-list"];
        put?: never;
        /**
         * Upload task attachments
         * @description Uploads one or more files as attachments to a task via multipart/form-data under the "files" field. Requires write access to the task. Each file is processed independently: a file that fails (for example, exceeding the configured size limit) is reported in the errors list while the others still succeed, so the request returns 201 even on a partial upload. The max size per file is the server's configured file size limit.
         */
        post: operations["task-attachments-upload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task}/attachments/{attachment}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a task attachment
         * @description Returns the raw bytes of one attachment. Requires read access to the task. Pass preview_size to get a downscaled PNG preview instead — only for image attachments; for non-images or an unknown size the original file is returned. The Content-Type header carries the file's real mime type.
         */
        get: operations["task-attachments-download"];
        put?: never;
        post?: never;
        /**
         * Delete a task attachment
         * @description Deletes one attachment and its underlying file. Requires write access to the task. The attachment must belong to the task in the path.
         */
        delete: operations["task-attachments-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the comments of a task
         * @description Returns the comments of the given task, paginated. Requires read access to the task. Pass order_by=desc to sort newest-first (default is oldest-first).
         */
        get: operations["task-comments-list"];
        put?: never;
        /**
         * Create a comment on a task
         * @description Adds a comment to the given task. The parent task is taken from the URL, not the body, and the author is the authenticated user. Requires write access to the task.
         */
        post: operations["task-comments-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task}/comments/{commentid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a single comment of a task
         * @description Returns one comment of a task. The comment must belong to the task in the path. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified.
         */
        get: operations["task-comments-read"];
        /**
         * Update a comment of a task
         * @description Replaces a comment's text. The comment must belong to the task in the path, and only its author may update it. Use PATCH for a partial update.
         */
        put: operations["task-comments-update"];
        post?: never;
        /**
         * Delete a comment of a task
         * @description Deletes a comment of a task. The comment must belong to the task in the path, and only its author may delete it.
         */
        delete: operations["task-comments-delete"];
        options?: never;
        head?: never;
        /**
         * Update a comment of a task (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-task-comments-read"];
        trace?: never;
    };
    "/tasks/{task}/position": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set a task's position in a view
         * @description Sets where a task sorts within one of its project's views. The position is per view, so this only affects the view named by project_view_id. Requires write access to the task. Positions below the minimum spacing make the server recalculate every position in the view, so the returned value may differ from the one sent.
         */
        put: operations["tasks-position-update"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task}/relations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a task relation
         * @description Relates two tasks. The authenticated user needs write access to the base task (in the path) and at least read access to the other task; the two tasks need not share a project. The inverse relation is created automatically (e.g. a subtask relation also stores the parenttask relation on the other task). Subtask/parenttask chains that would form a cycle are rejected.
         */
        post: operations["tasks-relations-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task}/relations/{relationKind}/{otherTask}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a task relation
         * @description Removes the relation identified by the base task, relation kind and other task. The automatically created inverse relation is removed as well. The authenticated user needs write access to the base task.
         */
        delete: operations["tasks-relations-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List teams
         * @description Returns the teams the authenticated user is a member of, paginated. Set include_public=true to also surface public teams the user is not a member of, where the instance has public teams enabled.
         */
        get: operations["teams-list"];
        put?: never;
        /**
         * Create a team
         * @description Creates a team; the authenticated user becomes its first member and an admin of it.
         */
        post: operations["teams-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a team
         * @description Returns a single team the user is a member of. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified.
         */
        get: operations["teams-read"];
        /**
         * Update a team
         * @description Replaces a team's fields — only a team admin may update it. Use PATCH for a partial update.
         */
        put: operations["teams-update"];
        post?: never;
        /**
         * Delete a team
         * @description Deletes a team and revokes the access it granted to all of its members. Only a team admin may delete it.
         */
        delete: operations["teams-delete"];
        options?: never;
        head?: never;
        /**
         * Update a team (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-teams-read"];
        trace?: never;
    };
    "/teams/{team}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a member to a team
         * @description Adds a user to a team by username. Only a team admin may add members.
         */
        post: operations["teams-members-add"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams/{team}/members/{user}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a member from a team
         * @description Removes a user from a team, revoking the access the team granted them. A team admin may remove anyone; a member may remove themselves. The last member of a team cannot be removed.
         */
        delete: operations["teams-members-remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams/{team}/members/{user}/admin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Toggle a team member's admin status
         * @description Flips the member's admin flag: an admin becomes a regular member and vice-versa. The request body is ignored. Only a team admin may do this.
         */
        post: operations["teams-members-toggle-admin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/time-entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List time entries
         * @description Returns the time entries the authenticated user can see, paginated. Filterable by date range, project, task and user.
         */
        get: operations["time-entries-list"];
        put?: never;
        /**
         * Create a time entry
         * @description Logs a manual time entry for the authenticated user. Exactly one of task_id / project_id must be set.
         */
        post: operations["time-entries-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/time-entries/timer/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stop the running timer
         * @description Stops the authenticated user's running timer, setting its end time to the server's current time, and returns the stopped entry. Returns 404 when no timer is running. Starting a timer and editing entries go through the regular create/update endpoints.
         */
        post: operations["time-entries-timer-stop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/time-entries/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a time entry
         * @description Returns a single time entry. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified.
         */
        get: operations["time-entries-read"];
        /**
         * Update a time entry
         * @description Updates a time entry. Only the author may update it. The entry can be moved between a task and a project — exactly one of task_id / project_id must be set, and you need read access to the new one. PUT replaces all editable fields; use PATCH for a partial update.
         */
        put: operations["time-entries-update"];
        post?: never;
        /**
         * Delete a time entry
         * @description Deletes a time entry. Only the author may delete it. If it is the running timer, deleting it removes that timer.
         */
        delete: operations["time-entries-delete"];
        options?: never;
        head?: never;
        /**
         * Update a time entry (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-time-entries-read"];
        trace?: never;
    };
    "/token/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Test a token
         * @description Returns 200 if the bearer token (JWT or API token) is valid. Used to check authentication.
         */
        get: operations["token-test"];
        put?: never;
        /**
         * Check a token
         * @description Returns 200 if the bearer token (JWT or API token) is valid. Used to check authentication.
         */
        post: operations["token-check"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List api tokens
         * @description Returns the api tokens owned by the authenticated user. Pass owner_id to list a bot's tokens instead — only bots owned by the caller are allowed.
         */
        get: operations["tokens-list"];
        put?: never;
        /**
         * Create an api token
         * @description Creates an api token for the authenticated user, or for a bot they own when owner_id is set. The cleartext token is returned once in this response and is never readable again.
         */
        post: operations["tokens-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tokens/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete an api token
         * @description Deletes an api token. The caller may delete their own tokens and tokens belonging to bots they own.
         */
        delete: operations["tokens-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the current user
         * @description Returns the authenticated user together with their settings and computed account facts (auth_provider, is_local_user, is_admin, deletion_scheduled_at).
         */
        get: operations["user-show"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/bots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List bot users
         * @description Returns only the bot users owned by the authenticated user. Bots owned by anyone else are never listed.
         */
        get: operations["bots-list"];
        put?: never;
        /**
         * Create a bot user
         * @description Creates a bot user owned by the authenticated user. The username must start with the 'bot-' prefix. Bots have no email or password and cannot create further bots. Requires a real user account — link shares cannot create bots.
         */
        post: operations["bots-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/bots/{bot}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a bot user
         * @description Returns a single bot user. Only the owner may read it; otherwise the request is refused. Sends an ETag; pass it as If-None-Match on a later read to get a 304 Not Modified.
         */
        get: operations["bots-read"];
        /**
         * Update a bot user
         * @description Updates an owned bot user's name, status, and username. Only the owner may update it. Use PATCH for a partial update.
         */
        put: operations["bots-update"];
        post?: never;
        /**
         * Delete a bot user
         * @description Permanently deletes an owned bot user and all data associated with it. Only the owner may delete it.
         */
        delete: operations["bots-delete"];
        options?: never;
        head?: never;
        /**
         * Update a bot user (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-bots-read"];
        trace?: never;
    };
    "/user/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm an email address
         * @description Confirms the email address of a newly registered user using the token sent to that email.
         */
        post: operations["auth-confirm-email"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/deletion/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel account deletion
         * @description Cancels a scheduled account deletion. Local users must provide their password.
         */
        post: operations["user-deletion-cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/deletion/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm account deletion
         * @description Confirms a requested account deletion using the token from the confirmation email and schedules the account for deletion.
         */
        post: operations["user-deletion-confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/deletion/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request account deletion
         * @description Starts deletion of the authenticated user's account. Local users must provide their password; a confirmation email is then sent and deletion only proceeds once confirmed.
         */
        post: operations["user-deletion-request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the current data export
         * @description Returns metadata about the authenticated user's current data export (id, size, creation and expiry time), or null if none has been prepared.
         */
        get: operations["user-export-status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/export/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Download the data export
         * @description Streams the authenticated user's prepared data export as a zip file. Local users must confirm with their password. Fails with 404 if no export has been prepared. A POST (not GET) because the password is sent in the body.
         */
        post: operations["user-export-download"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/export/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request a data export
         * @description Starts building a full export of the authenticated user's data. Local users must confirm with their password. The export runs in the background; an email is sent when it is ready to download.
         */
        post: operations["user-export-request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change the current user's password
         * @description Changes the authenticated user's password after verifying the old one. All of the user's existing sessions are invalidated.
         */
        post: operations["user-change-password"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/password/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reset a password
         * @description Sets a new password using a previously issued reset token. All of the user's existing sessions are invalidated.
         */
        post: operations["auth-password-reset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/password/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request a password reset token
         * @description Requests a token to reset the password for the account with the given email. The token is sent to that email; the response is the same whether or not an account exists.
         */
        post: operations["auth-password-token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List sessions
         * @description Returns the authenticated user's own active sessions, most recently active first. Never lists other users' sessions; link share tokens are forbidden.
         */
        get: operations["sessions-list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/sessions/{session}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a session
         * @description Revokes a session by its UUID. Only the owning user may delete it; deleting another user's session is forbidden.
         */
        delete: operations["sessions-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Upload your avatar
         * @description Uploads an image as the authenticated user's avatar and switches their avatar provider to "upload". The image is validated to be an image, resized server-side, and stored as PNG. Replaces any previously uploaded avatar (idempotent replace, hence PUT).
         */
        put: operations["user-avatar-upload"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/avatar/provider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the current user's avatar provider
         * @description Returns the avatar provider configured for the authenticated user.
         */
        get: operations["user-get-avatar-provider"];
        /**
         * Set the current user's avatar provider
         * @description Changes the avatar provider for the authenticated user. Valid values: gravatar, upload, initials, marble, ldap, openid, default.
         */
        put: operations["user-set-avatar-provider"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Set the current user's avatar provider (partial)
         * @description Partial update operation supporting both JSON Merge Patch & JSON Patch updates.
         */
        patch: operations["patch-user-get-avatar-provider"];
        trace?: never;
    };
    "/user/settings/email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update the current user's email address
         * @description Sets a new email address for the authenticated user after verifying their password. If the mailer is enabled the change is pending until the user confirms it via a link sent to the new address; otherwise it takes effect immediately.
         */
        put: operations["user-update-email"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/general": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update the current user's general settings
         * @description Replaces the authenticated user's general settings (name, reminders, discoverability, default project, week start, language, timezone, frontend settings).
         */
        put: operations["user-update-settings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/token/caldav": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List CalDAV tokens
         * @description Returns the authenticated user's CalDAV tokens. Only the id and creation date are returned — never the token value, which is shown once on creation.
         */
        get: operations["caldav-tokens-list"];
        put?: never;
        /**
         * Generate a CalDAV token
         * @description Generates a CalDAV token for the authenticated user. The clear-text token is returned only in this response and can never be retrieved again. Link shares cannot have CalDAV tokens.
         */
        post: operations["caldav-tokens-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/token/caldav/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a CalDAV token
         * @description Deletes one of the authenticated user's CalDAV tokens by id. Tokens of other users are out of scope and cannot be deleted.
         */
        delete: operations["caldav-tokens-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/totp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get totp status
         * @description Returns the authenticated user's current totp setting. Fails with 412 if totp was never enrolled. Local accounts only.
         */
        get: operations["totp-get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/totp/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disable totp
         * @description Removes all totp settings for the authenticated user. Requires the current password for confirmation. Local accounts only.
         */
        post: operations["totp-disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/totp/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enable totp
         * @description Activates a previously enrolled totp setting by confirming a passcode. All existing sessions are invalidated. Local accounts only.
         */
        post: operations["totp-enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/totp/enroll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enroll into totp
         * @description Creates the totp secret for the authenticated user. The setup must still be confirmed via the enable endpoint before it takes effect. Local accounts only.
         */
        post: operations["totp-enroll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/totp/qrcode": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the totp enrollment qr code
         * @description Returns the qr code for the authenticated user's enrolled totp setting as a jpeg image, for scanning into an authenticator app. Requires a prior enrollment. Local accounts only.
         */
        get: operations["totp-qrcode"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the current user's webhooks
         * @description Returns the webhook targets the authenticated user has configured for themselves (not project webhooks), paginated. Secret and basic-auth credentials are never included.
         */
        get: operations["user-webhooks-list"];
        put?: never;
        /**
         * Create a webhook for the current user
         * @description Creates a webhook target owned by the authenticated user that receives POST requests across all of their projects. The owning user is taken from the token, not the body. May only subscribe to user-directed events (see the events route). The secret and basic-auth credentials are write-only and not returned in the response.
         */
        post: operations["user-webhooks-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/webhooks/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List available user-directed webhook events
         * @description Returns the webhook event names a user-level webhook may subscribe to. This is a subset of the project webhook events — only events that target a single user.
         */
        get: operations["user-webhooks-events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/webhooks/{webhook}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a user webhook's events
         * @description Changes the events a user webhook subscribes to. Only the events list can be changed; target_url, secret and auth are immutable after creation. Only the owning user may update it.
         */
        put: operations["user-webhooks-update"];
        post?: never;
        /**
         * Delete a user webhook
         * @description Deletes a webhook owned by the authenticated user. Only the owning user may delete it.
         */
        delete: operations["user-webhooks-delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/timezones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List available time zones
         * @description Returns every time zone this Vikunja instance can handle. The list depends on the host system and is unsorted; sort it client-side.
         */
        get: operations["user-timezones"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Renew a link-share token
         * @description Issues a fresh JWT for the current link share. Only link-share tokens can be renewed here; user sessions must use the refresh-token flow.
         */
        post: operations["token-renew"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/token/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh user token
         * @description Exchanges the refresh-token cookie for a new short-lived JWT. The refresh token is rotated on every call, so the previous one stops working. A new HttpOnly refresh cookie is set on the response.
         */
        post: operations["auth-refresh-token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search users
         * @description Searches users by username, name or full email. Matching by name or email requires the target user to have made themselves discoverable, unless both users share an external (OIDC/LDAP) team. Email addresses are never returned.
         */
        get: operations["users-search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List available webhook events
         * @description Returns every event a webhook target can subscribe to. Use these values when creating or updating a webhook.
         */
        get: operations["webhooks-events-list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/{entitykind}/{entityid}/reactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List reactions for an entity
         * @description Returns every reaction on the entity, grouped as a map keyed by reaction value; each value maps to the users who reacted with it. Requires read access to the entity. Not paginated.
         */
        get: operations["reactions-list"];
        put?: never;
        /**
         * React to an entity
         * @description Adds the authenticated user's reaction to the entity. Requires write access. No-op if the same reaction already exists.
         */
        post: operations["reactions-create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/{entitykind}/{entityid}/reactions/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remove a reaction from an entity
         * @description Removes the authenticated user's own reaction from the entity. The reaction to remove is named in the body (there is no per-reaction id), so this is a POST with a body rather than a DELETE. Requires write access.
         */
        post: operations["reactions-delete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        APIToken: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/APIToken.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this api key was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: date-time
             * @description The date when this key expires.
             */
            expires_at?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this api key.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The user ID of the token owner. When creating a token for a bot user, set this to the bot's ID; the bot must be owned by the authenticated user. If omitted, defaults to the authenticated user.
             */
            owner_id?: number;
            /** @description The permissions this token has. Possible values are available via the /routes endpoint and consist of the keys of the list from that endpoint. For example, if the token should be able to read all tasks as well as update existing tasks, you should add {"tasks":["read_all","update"]}. */
            permissions?: {
                [key: string]: string[] | null;
            };
            /** @description A human-readable name for this token. */
            title?: string;
            /** @description The cleartext api key. Returned only once, in the response to creating the token; never readable again. */
            readonly token?: string;
        };
        AdminIsAdminPatchBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AdminIsAdminPatchBody.json
             */
            readonly $schema?: string;
            /** @description New admin flag. Omitting it leaves the current value unchanged. */
            is_admin?: boolean | null;
        };
        AdminOwnerPatchBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AdminOwnerPatchBody.json
             */
            readonly $schema?: string;
            /**
             * Format: int64
             * @description The numeric ID of the user who should become the project's owner.
             */
            owner_id?: number;
        };
        AdminSetPasswordBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AdminSetPasswordBody.json
             */
            readonly $schema?: string;
            /** @description The new password. Max 72 bytes (a bcrypt limit), which may be fewer than 72 characters. */
            new_password?: string;
        };
        AdminStatusPatchBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AdminStatusPatchBody.json
             */
            readonly $schema?: string;
            /**
             * Format: int64
             * @description New account status (0=active, 1=email-confirmation required, 2=disabled, 3=locked). Omitting it leaves the current value unchanged.
             */
            status?: number | null;
        };
        AdminUser: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AdminUser.json
             */
            readonly $schema?: string;
            /** @description Resolved auth provider name (e.g. 'LDAP' or an OIDC provider), empty for local accounts. */
            readonly auth_provider?: string;
            /**
             * Format: int64
             * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
             */
            readonly bot_owner_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user's email address. Always empty for bot users. */
            email?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this user.
             */
            readonly id?: number;
            /** @description Whether the user is an instance admin. */
            readonly is_admin?: boolean;
            /** @description Authentication issuer; empty or 'local' for local accounts. */
            readonly issuer?: string;
            /** @description The full name of the user. */
            name?: string;
            /**
             * Format: int64
             * @description Account status (0=active, 1=email-confirmation required, 2=disabled, 3=locked).
             */
            readonly status?: number;
            /** @description External subject identifier, for non-local accounts. */
            readonly subject?: string;
            /**
             * Format: date-time
             * @description A timestamp when this user was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
            username?: string;
        };
        AttachmentUploadError: {
            /**
             * Format: int64
             * @description Vikunja numeric error code, when the failure carries one.
             */
            code?: number;
            /** @description A human-readable description of why this file failed. */
            message?: string;
        };
        AttachmentUploadResult: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AttachmentUploadResult.json
             */
            readonly $schema?: string;
            /** @description Per-file failures. A file that fails here does not fail the whole request; the others still upload. */
            errors?: components["schemas"]["AttachmentUploadError"][] | null;
            /** @description The attachments that were created successfully. */
            success?: components["schemas"]["TaskAttachment"][] | null;
        };
        "Auth-link-shareRequest": {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Auth-link-shareRequest.json
             */
            readonly $schema?: string;
            /** @description The password for password-protected link shares. Ignored for shares without a password. */
            password?: string;
        };
        AuthInfo: {
            ldap?: components["schemas"]["LdapAuthInfo"];
            local?: components["schemas"]["LocalAuthInfo"];
            openid_connect?: components["schemas"]["OpenIDAuthInfo"];
        };
        AuthTokenBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AuthTokenBodyBody.json
             */
            readonly $schema?: string;
            /** @description The short-lived JWT auth token. Send it as a bearer token on subsequent requests. */
            readonly token?: string;
        };
        AuthorizeRequest: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AuthorizeRequest.json
             */
            readonly $schema?: string;
            client_id?: string;
            code_challenge?: string;
            code_challenge_method?: string;
            redirect_uri?: string;
            response_type?: string;
            state?: string;
        };
        AuthorizeResponse: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/AuthorizeResponse.json
             */
            readonly $schema?: string;
            code?: string;
            redirect_uri?: string;
            state?: string;
        };
        BotUser: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/BotUser.json
             */
            readonly $schema?: string;
            /**
             * Format: int64
             * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
             */
            readonly bot_owner_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user's email address. Always empty for bot users. */
            email?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this user.
             */
            readonly id?: number;
            /** @description The full name of the user. */
            name?: string;
            /**
             * Format: int64
             * @description The bot's status: 0=active, 2=disabled. Set to 2 to disable the bot, 0 to re-enable it.
             */
            status?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
            username?: string;
        };
        BotUserReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/BotUserReadBody.json
             */
            readonly $schema?: string;
            /**
             * Format: int64
             * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
             */
            readonly bot_owner_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user's email address. Always empty for bot users. */
            email?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this user.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this bot user (0=read, 1=read/write, 2=admin).
             */
            readonly max_permission?: number;
            /** @description The full name of the user. */
            name?: string;
            /**
             * Format: int64
             * @description The bot's status: 0=active, 2=disabled. Set to 2 to disable the bot, 0 to re-enable it.
             */
            status?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
            username?: string;
        };
        Bucket: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Bucket.json
             */
            readonly $schema?: string;
            /** Format: int64 */
            count?: number;
            /** Format: date-time */
            created?: string;
            created_by?: components["schemas"]["User"];
            /** Format: int64 */
            id?: number;
            /** Format: int64 */
            limit?: number;
            /** Format: double */
            position?: number;
            /** Format: int64 */
            project_view_id?: number;
            tasks?: components["schemas"]["Task"][] | null;
            title?: string;
            /** Format: date-time */
            updated?: string;
        };
        BucketsWithTasksBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/BucketsWithTasksBodyBody.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["Bucket"][] | null;
            /**
             * Format: int64
             * @description The number of buckets returned.
             */
            total?: number;
        };
        BulkAssignees: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/BulkAssignees.json
             */
            readonly $schema?: string;
            /** @description The full set of users to assign to the task. This replaces the task's current assignees: users not in this list are unassigned. Pass an empty array to unassign everyone. Each user must have access to the task's project. */
            assignees?: components["schemas"]["User"][] | null;
        };
        BulkTask: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/BulkTask.json
             */
            readonly $schema?: string;
            /** @description The names of the task fields to apply from values; only these fields are written, the rest of each task is left untouched. */
            fields?: string[] | null;
            /** @description The ids of the tasks to update. The user needs write access to every project these tasks belong to, or the whole request is rejected. */
            task_ids?: number[] | null;
            /** @description The updated tasks, returned in the response. */
            readonly tasks?: components["schemas"]["Task"][] | null;
            /** @description The task carrying the values to set. Only the fields named in fields are read from it and applied to every task. */
            values?: components["schemas"]["Task"];
        };
        ColumnMapping: {
            /**
             * @description The task attribute the column maps to. Use "ignore" to drop the column.
             * @enum {string}
             */
            attribute?: "title" | "description" | "due_date" | "start_date" | "end_date" | "done" | "priority" | "labels" | "project" | "reminder" | "ignore";
            /**
             * Format: int64
             * @description The zero-based index of the CSV column this mapping applies to.
             */
            column_index?: number;
            /** @description The header name of the CSV column, for display. */
            column_name?: string;
        };
        CreateUserBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/CreateUserBody.json
             */
            readonly $schema?: string;
            email?: string;
            /** @description Mark the new user as an instance admin. */
            is_admin?: boolean;
            /** @description IETF BCP 47 language code; must exist in Vikunja. */
            language?: string;
            /** @description The full name of the new user. Optional. */
            name?: string;
            password?: string;
            /** @description Activate the new user immediately, skipping email confirmation. */
            skip_email_confirm?: boolean;
            username?: string;
        };
        DatabaseNotification: {
            /**
             * Format: date-time
             * @description A timestamp when this notification was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this notification.
             */
            readonly id?: number;
            /** @description The name identifying the kind of notification. */
            readonly name?: string;
            /** @description The notification payload. Shape depends on the notification's name. */
            readonly notification?: unknown;
            /**
             * Format: date-time
             * @description When the notification was marked read; zero value while unread. Set via the read flag, not written directly.
             */
            readonly read_at?: string;
        };
        DatabaseNotifications: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/DatabaseNotifications.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this notification was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this notification.
             */
            readonly id?: number;
            /** @description The name identifying the kind of notification. */
            readonly name?: string;
            /** @description The notification payload. Shape depends on the notification's name. */
            readonly notification?: unknown;
            /** @description Set true to mark the notification read, false to mark it unread. */
            read?: boolean;
            /**
             * Format: date-time
             * @description When the notification was marked read; zero value while unread. Set via the read flag, not written directly.
             */
            readonly read_at?: string;
        };
        DetectionResult: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/DetectionResult.json
             */
            readonly $schema?: string;
            /** @description The detected column header names, in order. */
            columns?: string[] | null;
            /** @description The detected Go reference date layout used to parse date columns. */
            date_format?: string;
            /** @description The detected field delimiter (one of ",", ";", tab, "|"). */
            delimiter?: string;
            /** @description The first few raw rows of the file, for the client to render a preview. */
            preview_rows?: (string[] | null)[] | null;
            /** @description The detected quote character. */
            quote_char?: string;
            /** @description A best-guess column-to-attribute mapping; the client may edit it before previewing or migrating. */
            suggested_mapping?: components["schemas"]["ColumnMapping"][] | null;
        };
        EmailConfirm: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/EmailConfirm.json
             */
            readonly $schema?: string;
            token?: string;
        };
        ErrorDetail: {
            /** @description Where the error occurred, e.g. 'body.items[3].tags' or 'path.thing-id' */
            location?: string;
            /** @description Error message text */
            message?: string;
            /** @description The value at the given location */
            value?: unknown;
        };
        File: {
            /**
             * Format: date-time
             * @description A timestamp when this file was uploaded.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this file.
             */
            readonly id?: number;
            /** @description The detected mime type of the file. */
            readonly mime?: string;
            /** @description The original name of the uploaded file. */
            readonly name?: string;
            /**
             * Format: int64
             * @description The size of the file in bytes.
             */
            readonly size?: number;
        };
        HealthBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/HealthBodyBody.json
             */
            readonly $schema?: string;
            /** @description Availability of each configured OpenID Connect provider, from cached state — this endpoint never contacts the providers. Omitted when OpenID Connect authentication is not configured or the providers have not been initialized yet right after startup. */
            openid_providers?: components["schemas"]["ProviderStatus"][] | null;
            /**
             * @description "OK" when the service and its dependencies are reachable, "degraded" when the service itself is healthy but at least one configured OpenID Connect provider is not available.
             * @example OK
             * @enum {string}
             */
            status?: "OK" | "degraded";
        };
        Info: {
            /** Format: date-time */
            expires_at?: string;
            features?: string[] | null;
            instance_id?: string;
            last_check_failed?: boolean;
            licensed?: boolean;
            /** Format: int64 */
            max_users?: number;
            /** Format: date-time */
            validated_at?: string;
        };
        JsonPatchOp: {
            /** @description JSON Pointer for the source of a move or copy */
            from?: string;
            /**
             * @description Operation name
             * @enum {string}
             */
            op?: "add" | "remove" | "replace" | "move" | "copy" | "test";
            /** @description JSON Pointer to the field being operated on, or the destination of a move/copy operation */
            path?: string;
            /** @description The value to set */
            value?: unknown;
        };
        Label: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Label.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this label was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who created this label. */
            readonly created_by?: components["schemas"]["User"];
            /** @description The label description. */
            description?: string;
            /** @description The color this label has in hex format. */
            hex_color?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this label.
             */
            readonly id?: number;
            /** @description The title of the label. You'll see this one on tasks associated with it. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this label was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        LabelReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/LabelReadBody.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this label was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who created this label. */
            readonly created_by?: components["schemas"]["User"];
            /** @description The label description. */
            description?: string;
            /** @description The color this label has in hex format. */
            hex_color?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this label.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this label (0=read, 1=read/write, 2=admin).
             */
            readonly max_permission?: number;
            /** @description The title of the label. You'll see this one on tasks associated with it. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this label was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        LabelTask: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/LabelTask.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this label was added to the task. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The id of the label to associate with the task.
             */
            label_id?: number;
        };
        LabelTaskBulk: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/LabelTaskBulk.json
             */
            readonly $schema?: string;
            /** @description The complete set of labels the task should have after the call. Any label currently on the task that is not in this list is removed; any label in the list that is not yet on the task is added. You must be able to see every label you attach. */
            labels?: components["schemas"]["Label"][] | null;
        };
        LabelWithTaskID: {
            /**
             * Format: date-time
             * @description A timestamp when this label was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who created this label. */
            readonly created_by?: components["schemas"]["User"];
            /** @description The label description. */
            description?: string;
            /** @description The color this label has in hex format. */
            hex_color?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this label.
             */
            readonly id?: number;
            /** @description The title of the label. You'll see this one on tasks associated with it. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this label was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        LdapAuthInfo: {
            enabled?: boolean;
        };
        LegalInfo: {
            imprint_url?: string;
            privacy_policy_url?: string;
        };
        LinkShareReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/LinkShareReadBody.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this share was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The public hash used to access the shared project. Generated by the server; ignored on write. */
            readonly hash?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this link share.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this link share (0=read, 1=read/write, 2=admin).
             */
            readonly max_permission?: number;
            /** @description The name of this link share. All actions someone takes while authenticated through this link will appear under this name. */
            name?: string;
            /** @description The password protecting this link share. Write-only: it can be set on create but is never returned. */
            password?: string;
            /**
             * Format: int64
             * @description The permission this project is shared with: 0 = read only, 1 = read & write, 2 = admin.
             * @default 0
             */
            permission: number;
            /** @description The user who created this link share. */
            readonly shared_by?: components["schemas"]["User"];
            /**
             * Format: int64
             * @description The kind of this link, derived from whether a password was set: 0 = undefined, 1 = without password, 2 = with password.
             * @default 0
             */
            readonly sharing_type: number;
            /**
             * Format: date-time
             * @description A timestamp when this share was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        LinkShareToken: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/LinkShareToken.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this share was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The public hash used to access the shared project. Generated by the server; ignored on write. */
            readonly hash?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this link share.
             */
            readonly id?: number;
            /** @description The name of this link share. All actions someone takes while authenticated through this link will appear under this name. */
            name?: string;
            /** @description The password protecting this link share. Write-only: it can be set on create but is never returned. */
            password?: string;
            /**
             * Format: int64
             * @description The permission this project is shared with: 0 = read only, 1 = read & write, 2 = admin.
             * @default 0
             */
            permission: number;
            /**
             * Format: int64
             * @description The id of the project this share grants access to.
             */
            readonly project_id?: number;
            /** @description The user who created this link share. */
            readonly shared_by?: components["schemas"]["User"];
            /**
             * Format: int64
             * @description The kind of this link, derived from whether a password was set: 0 = undefined, 1 = without password, 2 = with password.
             * @default 0
             */
            readonly sharing_type: number;
            /** @example eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c */
            token?: string;
            /**
             * Format: date-time
             * @description A timestamp when this share was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        LinkSharing: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/LinkSharing.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this share was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The public hash used to access the shared project. Generated by the server; ignored on write. */
            readonly hash?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this link share.
             */
            readonly id?: number;
            /** @description The name of this link share. All actions someone takes while authenticated through this link will appear under this name. */
            name?: string;
            /** @description The password protecting this link share. Write-only: it can be set on create but is never returned. */
            password?: string;
            /**
             * Format: int64
             * @description The permission this project is shared with: 0 = read only, 1 = read & write, 2 = admin.
             * @default 0
             */
            permission: number;
            /** @description The user who created this link share. */
            readonly shared_by?: components["schemas"]["User"];
            /**
             * Format: int64
             * @description The kind of this link, derived from whether a password was set: 0 = undefined, 1 = without password, 2 = with password.
             * @default 0
             */
            readonly sharing_type: number;
            /**
             * Format: date-time
             * @description A timestamp when this share was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        LocalAuthInfo: {
            enabled?: boolean;
            registration_enabled?: boolean;
        };
        Login: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Login.json
             */
            readonly $schema?: string;
            long_token?: boolean;
            password?: string;
            totp_passcode?: string;
            username?: string;
        };
        LogoutBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/LogoutBodyBody.json
             */
            readonly $schema?: string;
            /** @description A human-readable confirmation message. */
            readonly message?: string;
            /** @description RP-Initiated Logout URL to redirect to for OpenID Connect sessions; empty otherwise. */
            readonly oidc_logout_url?: string;
        };
        MarkAllReadBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/MarkAllReadBodyBody.json
             */
            readonly $schema?: string;
            /** @description A confirmation message. */
            readonly message?: string;
        };
        Message: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Message.json
             */
            readonly $schema?: string;
            /** @description A human-readable status message returned by the server. */
            readonly message?: string;
        };
        MessageBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/MessageBodyBody.json
             */
            readonly $schema?: string;
            /** @description A human-readable confirmation message. */
            readonly message?: string;
        };
        MigrationStartedBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/MigrationStartedBodyBody.json
             */
            readonly $schema?: string;
            /** @description A confirmation message. */
            readonly message?: string;
        };
        OpenIDAuthInfo: {
            enabled?: boolean;
            providers?: components["schemas"]["Provider"][] | null;
        };
        Overview: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Overview.json
             */
            readonly $schema?: string;
            /** @description Snapshot of the instance license state. */
            readonly license?: components["schemas"]["Info"];
            /**
             * Format: int64
             * @description Total number of projects.
             */
            readonly projects?: number;
            /** @description Aggregate share counts. */
            readonly shares?: components["schemas"]["ShareCounts"];
            /**
             * Format: int64
             * @description Total number of tasks.
             */
            readonly tasks?: number;
            /**
             * Format: int64
             * @description Total number of teams.
             */
            readonly teams?: number;
            /**
             * Format: int64
             * @description Total number of user accounts.
             */
            readonly users?: number;
        };
        PaginatedAPIToken: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedAPIToken.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["APIToken"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedBotUser: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedBotUser.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["BotUser"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedBucket: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedBucket.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["Bucket"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedDatabaseNotification: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedDatabaseNotification.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["DatabaseNotification"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedLabelWithTaskID: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedLabelWithTaskID.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["LabelWithTaskID"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedLinkSharing: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedLinkSharing.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["LinkSharing"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedProject: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedProject.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["Project"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedProjectView: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedProjectView.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["ProjectView"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedSession: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedSession.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["Session"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedTask: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedTask.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["Task"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedTaskAttachment: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedTaskAttachment.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["TaskAttachment"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedTaskComment: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedTaskComment.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["TaskComment"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedTeam: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedTeam.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["Team"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedTeamWithPermission: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedTeamWithPermission.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["TeamWithPermission"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedTimeEntry: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedTimeEntry.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["TimeEntry"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedToken: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedToken.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["Token"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedUser: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedUser.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["User"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedUserWithPermission: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedUserWithPermission.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["UserWithPermission"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PaginatedWebhook: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PaginatedWebhook.json
             */
            readonly $schema?: string;
            items?: components["schemas"]["Webhook"][] | null;
            /** Format: int64 */
            page?: number;
            /** Format: int64 */
            per_page?: number;
            /** Format: int64 */
            total?: number;
            /** Format: int64 */
            total_pages?: number;
        };
        PasswordReset: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PasswordReset.json
             */
            readonly $schema?: string;
            new_password?: string;
            token?: string;
        };
        PasswordTokenRequest: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PasswordTokenRequest.json
             */
            readonly $schema?: string;
            email?: string;
        };
        PreviewResult: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/PreviewResult.json
             */
            readonly $schema?: string;
            /** @description The first few tasks that would be imported with the given config. */
            tasks?: components["schemas"]["PreviewTask"][] | null;
            /**
             * Format: int64
             * @description The total number of data rows in the file.
             */
            total_rows?: number;
        };
        PreviewTask: {
            description?: string;
            done?: boolean;
            due_date?: string;
            end_date?: string;
            labels?: string[] | null;
            /** Format: int64 */
            priority?: number;
            project?: string;
            start_date?: string;
            title?: string;
        };
        Project: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Project.json
             */
            readonly $schema?: string;
            /** @description A small BlurHash preview of the project background, shown until the real background loads. See https://blurha.sh/. */
            readonly background_blur_hash?: string;
            /** @description Extra information about the background (e.g. attribution). When not null, the background is available at /projects/{projectID}/background. */
            readonly background_information?: unknown;
            /**
             * Format: date-time
             * @description A timestamp when this project was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The description of the project. */
            description?: string;
            /** @description The hex color of this project, without the leading #. */
            hex_color?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this project.
             */
            readonly id?: number;
            /** @description The unique project short identifier. Used to build task identifiers (e.g. PROJ-123). */
            identifier?: string;
            /** @description Whether the project is archived. Archived projects are read-only. */
            is_archived?: boolean;
            /** @description Whether the project is a favorite of the requesting user. This value is per-user and depends on who makes the call. */
            is_favorite?: boolean;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this project (0 = read, 1 = read/write, 2 = admin).
             */
            readonly max_permission?: number;
            /** @description The user who owns this project. Set by the server; ignored on write. */
            readonly owner?: components["schemas"]["User"];
            /**
             * Format: int64
             * @description The id of the parent project. 0 or omitted for a top-level project. Sending an explicit 0 detaches the project to the top level and requires admin permission.
             */
            parent_project_id?: number;
            /**
             * Format: double
             * @description The position of this project when listing all projects. See the tasks.position property for how positions work.
             */
            position?: number;
            /** @description The requesting user's subscription status for this project. Read-only here; use the subscription endpoints to change it. Only returned when retrieving a single project. */
            readonly subscription?: components["schemas"]["Subscription"];
            /** @description The title of the project. You'll see this in the overview. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this project was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The views configured for this project. Managed through the project view endpoints. */
            readonly views?: components["schemas"]["ProjectView"][] | null;
        };
        ProjectDuplicate: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/ProjectDuplicate.json
             */
            readonly $schema?: string;
            /** @description Whether to copy the project's user, team and link shares to the duplicate. Defaults to false. */
            duplicate_shares?: boolean;
            /** @description The newly created duplicate project, populated by the server in the response. */
            readonly duplicated_project?: components["schemas"]["Project"];
            /**
             * Format: int64
             * @description The id of the project under which the duplicate should be created. Omit or 0 to place the copy at the top level; you need write access to the parent.
             */
            parent_project_id?: number;
        };
        ProjectReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/ProjectReadBody.json
             */
            readonly $schema?: string;
            /** @description A small BlurHash preview of the project background, shown until the real background loads. See https://blurha.sh/. */
            readonly background_blur_hash?: string;
            /** @description Extra information about the background (e.g. attribution). When not null, the background is available at /projects/{projectID}/background. */
            readonly background_information?: unknown;
            /**
             * Format: date-time
             * @description A timestamp when this project was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The description of the project. */
            description?: string;
            /** @description The hex color of this project, without the leading #. */
            hex_color?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this project.
             */
            readonly id?: number;
            /** @description The unique project short identifier. Used to build task identifiers (e.g. PROJ-123). */
            identifier?: string;
            /** @description Whether the project is archived. Archived projects are read-only. */
            is_archived?: boolean;
            /** @description Whether the project is a favorite of the requesting user. This value is per-user and depends on who makes the call. */
            is_favorite?: boolean;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this project (0 = read, 1 = read/write, 2 = admin).
             */
            readonly max_permission?: number;
            /** @description The user who owns this project. Set by the server; ignored on write. */
            readonly owner?: components["schemas"]["User"];
            /**
             * Format: int64
             * @description The id of the parent project. 0 or omitted for a top-level project. Sending an explicit 0 detaches the project to the top level and requires admin permission.
             */
            parent_project_id?: number;
            /**
             * Format: double
             * @description The position of this project when listing all projects. See the tasks.position property for how positions work.
             */
            position?: number;
            /** @description The requesting user's subscription status for this project. Read-only here; use the subscription endpoints to change it. Only returned when retrieving a single project. */
            readonly subscription?: components["schemas"]["Subscription"];
            /** @description The title of the project. You'll see this in the overview. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this project was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The views configured for this project. Managed through the project view endpoints. */
            readonly views?: components["schemas"]["ProjectView"][] | null;
        };
        ProjectUser: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/ProjectUser.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this relation was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this project <-> user relation.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The permission this user has on the project. 0 = Read only, 1 = Read & Write, 2 = Admin.
             * @default 0
             */
            permission: number;
            /**
             * Format: date-time
             * @description A timestamp when this relation was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The username of the user to share with. On update and delete this comes from the URL path, not the body. */
            username?: string;
        };
        ProjectView: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/ProjectView.json
             */
            readonly $schema?: string;
            /** @description When the bucket configuration mode is filter, holds the title and filter of each bucket. */
            bucket_configuration?: components["schemas"]["ProjectViewBucketConfiguration"][] | null;
            /**
             * @description The bucket configuration mode. One of none, manual or filter. manual lets you move tasks between buckets; filter creates a bucket per filter.
             * @enum {string}
             */
            bucket_configuration_mode?: "none" | "manual" | "filter";
            /**
             * Format: date-time
             * @description A timestamp when this view was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The id of the bucket new tasks without a bucket are added to. Defaults to the leftmost bucket.
             */
            default_bucket_id?: number;
            /**
             * Format: int64
             * @description The id of the done bucket. Tasks moved here are marked done, and tasks marked done are moved here.
             */
            done_bucket_id?: number;
            /** @description The filter query used to match tasks shown in this view. See https://vikunja.io/docs/filters. */
            filter?: components["schemas"]["TaskCollection"];
            /**
             * Format: int64
             * @description The unique, numeric id of this view. Set by the server.
             */
            readonly id?: number;
            /**
             * Format: double
             * @description The position of this view in the project's list of views. Views are sorted ascending by this value.
             */
            position?: number;
            /**
             * Format: int64
             * @description The project this view belongs to. Taken from the URL path; ignored on write.
             */
            readonly project_id?: number;
            /** @description The title of this view. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this view was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /**
             * @description The kind of this view. One of list, gantt, table or kanban.
             * @enum {string}
             */
            view_kind?: "list" | "gantt" | "table" | "kanban";
        };
        ProjectViewBucketConfiguration: {
            /** @description The filter query that decides which tasks land in this bucket. See https://vikunja.io/docs/filters. */
            filter?: components["schemas"]["TaskCollection"];
            /** @description The title of the bucket this configuration creates. */
            title?: string;
        };
        ProjectViewReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/ProjectViewReadBody.json
             */
            readonly $schema?: string;
            /** @description When the bucket configuration mode is filter, holds the title and filter of each bucket. */
            bucket_configuration?: components["schemas"]["ProjectViewBucketConfiguration"][] | null;
            /**
             * @description The bucket configuration mode. One of none, manual or filter. manual lets you move tasks between buckets; filter creates a bucket per filter.
             * @enum {string}
             */
            bucket_configuration_mode?: "none" | "manual" | "filter";
            /**
             * Format: date-time
             * @description A timestamp when this view was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The id of the bucket new tasks without a bucket are added to. Defaults to the leftmost bucket.
             */
            default_bucket_id?: number;
            /**
             * Format: int64
             * @description The id of the done bucket. Tasks moved here are marked done, and tasks marked done are moved here.
             */
            done_bucket_id?: number;
            /** @description The filter query used to match tasks shown in this view. See https://vikunja.io/docs/filters. */
            filter?: components["schemas"]["TaskCollection"];
            /**
             * Format: int64
             * @description The unique, numeric id of this view. Set by the server.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this view (0=read, 1=read/write, 2=admin).
             */
            readonly max_permission?: number;
            /**
             * Format: double
             * @description The position of this view in the project's list of views. Views are sorted ascending by this value.
             */
            position?: number;
            /**
             * Format: int64
             * @description The project this view belongs to. Taken from the URL path; ignored on write.
             */
            readonly project_id?: number;
            /** @description The title of this view. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this view was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /**
             * @description The kind of this view. One of list, gantt, table or kanban.
             * @enum {string}
             */
            view_kind?: "list" | "gantt" | "table" | "kanban";
        };
        Provider: {
            auth_url?: string;
            client_id?: string;
            email_fallback?: boolean;
            force_user_info?: boolean;
            key?: string;
            logout_url?: string;
            name?: string;
            scope?: string;
            username_fallback?: boolean;
        };
        ProviderStatus: {
            /** @description True when the provider is initialized and offered for login. This reflects the last initialization attempt, not the provider's current reachability. A configured but unavailable provider was unreachable or misconfigured when Vikunja last initialized its providers; initialization is retried automatically with exponential backoff, after at most 15 minutes. */
            available?: boolean;
            /** @description The config key of the provider. */
            key?: string;
        };
        Reaction: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Reaction.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this reaction was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who reacted. Set by the server from the authenticated user; ignored on write. */
            readonly user?: components["schemas"]["User"];
            /** @description The reaction itself: any UTF text up to 20 characters, e.g. an emoji. */
            value?: string;
        };
        RenewTokenBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/RenewTokenBodyBody.json
             */
            readonly $schema?: string;
            /** @description The renewed JWT auth token. */
            readonly token?: string;
        };
        RouteDetail: {
            method?: string;
            path?: string;
        };
        SavedFilter: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/SavedFilter.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this filter was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The description of the filter. */
            description?: string;
            /** @description The task filter query and collection options this saved filter wraps. */
            filters?: components["schemas"]["TaskCollection"];
            /**
             * Format: int64
             * @description The unique, numeric id of this saved filter.
             */
            readonly id?: number;
            /** @description If true, the filter shows up in the Favorites pseudo-project alongside favorite projects. */
            is_favorite?: boolean;
            /** @description The user who owns this filter; set by the server. */
            readonly owner?: components["schemas"]["User"];
            /** @description The title of the filter. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this filter was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        SavedFilterReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/SavedFilterReadBody.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this filter was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The description of the filter. */
            description?: string;
            /** @description The task filter query and collection options this saved filter wraps. */
            filters?: components["schemas"]["TaskCollection"];
            /**
             * Format: int64
             * @description The unique, numeric id of this saved filter.
             */
            readonly id?: number;
            /** @description If true, the filter shows up in the Favorites pseudo-project alongside favorite projects. */
            is_favorite?: boolean;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this saved filter (0=read, 1=read/write, 2=admin). Filters are owner-only, so this is always 2 for a successful read.
             */
            readonly max_permission?: number;
            /** @description The user who owns this filter; set by the server. */
            readonly owner?: components["schemas"]["User"];
            /** @description The title of the filter. */
            title?: string;
            /**
             * Format: date-time
             * @description A timestamp when this filter was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        Session: {
            /**
             * Format: date-time
             * @description When this session was created (login time).
             */
            readonly created?: string;
            /** @description User-Agent string captured from the login request. */
            readonly device_info?: string;
            /** @description The session UUID; embedded in JWTs as the sid claim. */
            readonly id?: string;
            /** @description IP address captured from the login request. */
            readonly ip_address?: string;
            /**
             * Format: date-time
             * @description When this session was last refreshed.
             */
            readonly last_active?: string;
            /** @description The cleartext refresh token; returned only once by the login flow, never on listing. */
            readonly refresh_token?: string;
        };
        ShareCounts: {
            /**
             * Format: int64
             * @description Number of link shares across all projects.
             */
            readonly link_shares?: number;
            /**
             * Format: int64
             * @description Number of team-project shares.
             */
            readonly team_shares?: number;
            /**
             * Format: int64
             * @description Number of user-project shares.
             */
            readonly user_shares?: number;
        };
        Status: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Status.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description When the last migration finished. Zero value while a migration is still running or was never run.
             */
            readonly finished_at?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this migration status.
             */
            readonly id?: number;
            /** @description The name of the migrator this status belongs to, e.g. "todoist". */
            readonly migrator_name?: string;
            /**
             * Format: date-time
             * @description When the last migration started. Zero value if the user never migrated from this service.
             */
            readonly started_at?: string;
        };
        Subscription: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Subscription.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this subscription was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The kind of entity this subscription is for. Either project or task; derived server-side from the request path.
             */
            readonly entity?: number;
            /**
             * Format: int64
             * @description The numeric id of the subscribed entity; taken from the request path.
             */
            readonly entity_id?: number;
            /**
             * Format: int64
             * @description The numeric id of the subscription.
             */
            readonly id?: number;
        };
        TOTP: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TOTP.json
             */
            readonly $schema?: string;
            /** @description Whether totp is fully activated. Set to true only after the user confirms a passcode. */
            readonly enabled?: boolean;
            /** @description The shared secret used to generate passcodes, generated by the server on enrollment. */
            readonly secret?: string;
            /** @description The otpauth:// url, generated by the server, used to enroll the user in an authenticator app. */
            readonly url?: string;
        };
        Task: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Task.json
             */
            readonly $schema?: string;
            /** @description The users assigned to this task. Read-only here; use the task-assignee endpoints to change assignments. */
            readonly assignees?: components["schemas"]["User"][] | null;
            /** @description The task's attachments. Read-only here; use the attachment endpoints to add or remove them. */
            readonly attachments?: components["schemas"]["TaskAttachment"][] | null;
            /**
             * Format: int64
             * @description The bucket the task is in. Only populated when the task is accessed via a view with buckets. To move a task between buckets, the new bucket must be in the same view as the old one.
             */
            bucket_id?: number;
            /** @description The task's buckets across all views. Only present when requested via the buckets expand option. */
            readonly buckets?: components["schemas"]["Bucket"][] | null;
            /**
             * Format: int64
             * @description The number of comments on this task. Only present when requested via the comment_count expand option.
             */
            readonly comment_count?: number;
            /** @description The task's first 50 comments. Only present when requested via the comments expand option. */
            readonly comments?: components["schemas"]["TaskComment"][] | null;
            /**
             * Format: int64
             * @description The id of the attachment used as this task's cover image, or 0 for none.
             */
            cover_image_attachment_id?: number;
            /**
             * Format: date-time
             * @description When this task was created. Set by the server; ignored on write.
             */
            readonly created?: string;
            /** @description The user who created this task. Set by the server. */
            readonly created_by?: components["schemas"]["User"];
            /**
             * Format: date-time
             * @description When this task was soft-deleted. Soft-deleted tasks are kept for 30 days before they are removed permanently.
             */
            readonly deleted_at?: string;
            description?: string;
            done?: boolean;
            /**
             * Format: date-time
             * @description When the task was marked as done. Set by the server; ignored on write.
             */
            readonly done_at?: string;
            /** Format: date-time */
            due_date?: string;
            /** Format: date-time */
            end_date?: string;
            /** @description The task color as a hex string without the leading '#'. */
            hex_color?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this task.
             */
            readonly id?: number;
            /** @description The textual task identifier, derived from the project identifier and the task index (e.g. "PROJ-12"). */
            readonly identifier?: string;
            /**
             * Format: int64
             * @description The per-project task index, assigned by the server.
             */
            readonly index?: number;
            /** @description Whether the requesting user has favorited this task. Per-user, so it differs between callers. */
            is_favorite?: boolean;
            /** @description Whether the task is unread for the requesting user. Only present when requested via the is_unread expand option. */
            readonly is_unread?: boolean;
            /** @description The labels on this task. Read-only here; use the label-task endpoints to add or remove labels. */
            readonly labels?: components["schemas"]["Label"][] | null;
            /**
             * Format: double
             * @description How far the task is from done, between 0 and 1.
             */
            percent_done?: number;
            /**
             * Format: double
             * @description The task's position, saved per view. Only non-zero when the task is fetched through a view endpoint; use the task-position endpoint to change it.
             */
            readonly position?: number;
            /** Format: int64 */
            priority?: number;
            /**
             * Format: int64
             * @description The id of the project this task belongs to. On create it is taken from the URL; on update, setting it to a different project moves the task (requires write access to the target project).
             */
            project_id?: number;
            /** @description Reactions on this task. Only present when requested via the reactions expand option. */
            readonly reactions?: {
                [key: string]: components["schemas"]["User"][] | null;
            };
            /** @description Related tasks grouped by relation kind. Read-only here; use the task-relation endpoints to change relations. */
            readonly related_tasks?: {
                [key: string]: components["schemas"]["Task"][] | null;
            };
            reminders?: components["schemas"]["TaskReminder"][] | null;
            /**
             * Format: int64
             * @description The interval in seconds this task repeats. When set, marking the task done re-opens it and bumps its reminders and due date by this amount.
             */
            repeat_after?: number;
            /**
             * Format: int64
             * @description How the task repeats when marked done: 0 = after repeat_after seconds, 1 = monthly (ignores repeat_after), 2 = from the current date rather than the last set date.
             */
            repeat_mode?: number;
            /** Format: date-time */
            start_date?: string;
            /** @description The requesting user's subscription to this task. Read-only here; use the subscription endpoints to change it. Only present when reading a single task. */
            readonly subscription?: components["schemas"]["Subscription"];
            /**
             * Format: int64
             * @description The number of time entries on this task. Only present when requested via the time_entries_count expand option.
             */
            readonly time_entries_count?: number;
            /** @description The task title. This is what you'll see in the project. */
            title?: string;
            /**
             * Format: date-time
             * @description When this task was last updated. Set by the server; ignored on write.
             */
            readonly updated?: string;
        };
        TaskAssginee: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskAssginee.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this assignment was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The id of the user to assign to the task. The user must have access to the task's project.
             */
            user_id?: number;
        };
        TaskAttachment: {
            /**
             * Format: date-time
             * @description A timestamp when this attachment was uploaded. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who uploaded this attachment. */
            readonly created_by?: components["schemas"]["User"];
            /** @description Metadata of the uploaded file (name, mime type, size). The bytes are fetched from the download endpoint, not this field. */
            readonly file?: components["schemas"]["File"];
            /**
             * Format: int64
             * @description The unique, numeric id of this attachment.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The id of the task this attachment belongs to. Taken from the URL, not the body.
             */
            readonly task_id?: number;
        };
        TaskBucket: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskBucket.json
             */
            readonly $schema?: string;
            /** @description The resolved target bucket, including its updated task count. */
            readonly bucket?: components["schemas"]["Bucket"];
            /**
             * Format: int64
             * @description The bucket to move the task into. On /api/v2 this is taken from the URL; a value in the body is ignored.
             */
            bucket_id?: number;
            /**
             * Format: int64
             * @description The view the bucket belongs to. On /api/v2 this is taken from the URL; a value in the body is ignored.
             */
            project_view_id?: number;
            /** @description The task as it stands after the move, reflecting any done-state change. */
            readonly task?: components["schemas"]["Task"];
            /**
             * Format: int64
             * @description The id of the task to place in the bucket.
             */
            task_id?: number;
        };
        TaskCollection: {
            /** @description The filter query to match tasks by. See https://vikunja.io/docs/filters. */
            filter?: string;
            /** @description If true, the result also includes tasks whose filtered field is null. */
            filter_include_nulls?: boolean;
            /** @description The order for each sort_by field, either asc or desc. Defaults to asc. */
            order_by?: string[] | null;
            /** @description A search term to match tasks by their title. */
            s?: string;
            /** @description The fields to sort by, for example done or priority. The special value relevance sorts by search relevance (most relevant first, requires s; ignored when the database cannot score the query). */
            sort_by?: string[] | null;
        };
        TaskComment: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskComment.json
             */
            readonly $schema?: string;
            /** @description The user who wrote the comment. Set from the authenticated user on create; ignored on write. */
            readonly author?: components["schemas"]["User"];
            /** @description The comment text. May contain HTML; mentions are parsed and notify the mentioned users. */
            comment?: string;
            /**
             * Format: date-time
             * @description A timestamp when this comment was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this comment.
             */
            readonly id?: number;
            /** @description The reactions on this comment, keyed by reaction value. Managed through the reactions endpoints, not by writing here. */
            readonly reactions?: {
                [key: string]: components["schemas"]["User"][] | null;
            };
            /**
             * Format: date-time
             * @description A timestamp when this comment was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        TaskCommentReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskCommentReadBody.json
             */
            readonly $schema?: string;
            /** @description The user who wrote the comment. Set from the authenticated user on create; ignored on write. */
            readonly author?: components["schemas"]["User"];
            /** @description The comment text. May contain HTML; mentions are parsed and notify the mentioned users. */
            comment?: string;
            /**
             * Format: date-time
             * @description A timestamp when this comment was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this comment.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this comment's parent task (0=read, 1=read/write, 2=admin). Editing or deleting a comment also requires being its author, so this can over-state what the user may do to the comment.
             */
            readonly max_permission?: number;
            /** @description The reactions on this comment, keyed by reaction value. Managed through the reactions endpoints, not by writing here. */
            readonly reactions?: {
                [key: string]: components["schemas"]["User"][] | null;
            };
            /**
             * Format: date-time
             * @description A timestamp when this comment was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        TaskDuplicate: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskDuplicate.json
             */
            readonly $schema?: string;
            /** @description The newly created duplicate task, populated by the server in the response. */
            readonly duplicated_task?: components["schemas"]["Task"];
        };
        TaskPosition: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskPosition.json
             */
            readonly $schema?: string;
            /**
             * Format: double
             * @description The task's sort position within the view, as a float so a task can be placed between any two others. To drop a task between two neighbours, set this to their midpoint. Values below the minimum spacing trigger a server-side recalculation of all positions in the view, so the stored value may differ from what you sent.
             */
            position?: number;
            /**
             * Format: int64
             * @description The id of the project view this position applies to. Positions are stored per view, so the same task has an independent position in each of its project's views.
             */
            project_view_id?: number;
            /**
             * Format: int64
             * @description The numeric id of the task this position belongs to. Taken from the URL; ignored in the request body.
             */
            readonly task_id?: number;
        };
        TaskReadBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskReadBodyBody.json
             */
            readonly $schema?: string;
            /** @description A confirmation message. */
            readonly message?: string;
        };
        TaskReadOneBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskReadOneBody.json
             */
            readonly $schema?: string;
            /** @description The users assigned to this task. Read-only here; use the task-assignee endpoints to change assignments. */
            readonly assignees?: components["schemas"]["User"][] | null;
            /** @description The task's attachments. Read-only here; use the attachment endpoints to add or remove them. */
            readonly attachments?: components["schemas"]["TaskAttachment"][] | null;
            /**
             * Format: int64
             * @description The bucket the task is in. Only populated when the task is accessed via a view with buckets. To move a task between buckets, the new bucket must be in the same view as the old one.
             */
            bucket_id?: number;
            /** @description The task's buckets across all views. Only present when requested via the buckets expand option. */
            readonly buckets?: components["schemas"]["Bucket"][] | null;
            /**
             * Format: int64
             * @description The number of comments on this task. Only present when requested via the comment_count expand option.
             */
            readonly comment_count?: number;
            /** @description The task's first 50 comments. Only present when requested via the comments expand option. */
            readonly comments?: components["schemas"]["TaskComment"][] | null;
            /**
             * Format: int64
             * @description The id of the attachment used as this task's cover image, or 0 for none.
             */
            cover_image_attachment_id?: number;
            /**
             * Format: date-time
             * @description When this task was created. Set by the server; ignored on write.
             */
            readonly created?: string;
            /** @description The user who created this task. Set by the server. */
            readonly created_by?: components["schemas"]["User"];
            /**
             * Format: date-time
             * @description When this task was soft-deleted. Soft-deleted tasks are kept for 30 days before they are removed permanently.
             */
            readonly deleted_at?: string;
            description?: string;
            done?: boolean;
            /**
             * Format: date-time
             * @description When the task was marked as done. Set by the server; ignored on write.
             */
            readonly done_at?: string;
            /** Format: date-time */
            due_date?: string;
            /** Format: date-time */
            end_date?: string;
            /** @description The task color as a hex string without the leading '#'. */
            hex_color?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this task.
             */
            readonly id?: number;
            /** @description The textual task identifier, derived from the project identifier and the task index (e.g. "PROJ-12"). */
            readonly identifier?: string;
            /**
             * Format: int64
             * @description The per-project task index, assigned by the server.
             */
            readonly index?: number;
            /** @description Whether the requesting user has favorited this task. Per-user, so it differs between callers. */
            is_favorite?: boolean;
            /** @description Whether the task is unread for the requesting user. Only present when requested via the is_unread expand option. */
            readonly is_unread?: boolean;
            /** @description The labels on this task. Read-only here; use the label-task endpoints to add or remove labels. */
            readonly labels?: components["schemas"]["Label"][] | null;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this task (0=read, 1=read/write, 2=admin).
             */
            readonly max_permission?: number;
            /**
             * Format: double
             * @description How far the task is from done, between 0 and 1.
             */
            percent_done?: number;
            /**
             * Format: double
             * @description The task's position, saved per view. Only non-zero when the task is fetched through a view endpoint; use the task-position endpoint to change it.
             */
            readonly position?: number;
            /** Format: int64 */
            priority?: number;
            /**
             * Format: int64
             * @description The id of the project this task belongs to. On create it is taken from the URL; on update, setting it to a different project moves the task (requires write access to the target project).
             */
            project_id?: number;
            /** @description Reactions on this task. Only present when requested via the reactions expand option. */
            readonly reactions?: {
                [key: string]: components["schemas"]["User"][] | null;
            };
            /** @description Related tasks grouped by relation kind. Read-only here; use the task-relation endpoints to change relations. */
            readonly related_tasks?: {
                [key: string]: components["schemas"]["Task"][] | null;
            };
            reminders?: components["schemas"]["TaskReminder"][] | null;
            /**
             * Format: int64
             * @description The interval in seconds this task repeats. When set, marking the task done re-opens it and bumps its reminders and due date by this amount.
             */
            repeat_after?: number;
            /**
             * Format: int64
             * @description How the task repeats when marked done: 0 = after repeat_after seconds, 1 = monthly (ignores repeat_after), 2 = from the current date rather than the last set date.
             */
            repeat_mode?: number;
            /** Format: date-time */
            start_date?: string;
            /** @description The requesting user's subscription to this task. Read-only here; use the subscription endpoints to change it. Only present when reading a single task. */
            readonly subscription?: components["schemas"]["Subscription"];
            /**
             * Format: int64
             * @description The number of time entries on this task. Only present when requested via the time_entries_count expand option.
             */
            readonly time_entries_count?: number;
            /** @description The task title. This is what you'll see in the project. */
            title?: string;
            /**
             * Format: date-time
             * @description When this task was last updated. Set by the server; ignored on write.
             */
            readonly updated?: string;
        };
        TaskRelation: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TaskRelation.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this relation was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who created this relation. */
            readonly created_by?: components["schemas"]["User"];
            /**
             * Format: int64
             * @description The id of the other task this relation points to.
             */
            other_task_id?: number;
            /**
             * @description The kind of relation, describing the direction from the base task to the other task (e.g. subtask, blocking, related). The inverse relation is created automatically.
             * @enum {string}
             */
            relation_kind?: "subtask" | "parenttask" | "related" | "duplicateof" | "duplicates" | "blocking" | "blocked" | "precedes" | "follows" | "copiedfrom" | "copiedto";
            /**
             * Format: int64
             * @description The id of the base task. Set from the URL path; ignored in the request body.
             */
            readonly task_id?: number;
        };
        TaskReminder: {
            /** Format: int64 */
            relative_period?: number;
            relative_to?: string;
            /** Format: date-time */
            reminder?: string;
        };
        Team: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Team.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this team was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who created this team. Set by the server. */
            readonly created_by?: components["schemas"]["User"];
            description?: string;
            /** @description The team's external id, set by the openid or ldap provider that created it. Read-only for clients. */
            readonly external_id?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this team.
             */
            readonly id?: number;
            /** @description Whether the team should be publicly discoverable when sharing a project. Only effective if public teams are enabled on the instance. */
            is_public?: boolean;
            /** @description All members of this team. Managed through the team members endpoints, not by writing to this field. */
            readonly members?: components["schemas"]["TeamUser"][] | null;
            /** @description The name of this team. */
            name?: string;
            /**
             * Format: date-time
             * @description A timestamp when this team was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        TeamMember: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TeamMember.json
             */
            readonly $schema?: string;
            /** @description Whether the member is an admin of the team. Team admins can add and remove members and toggle other members' admin status. */
            admin?: boolean;
            /**
             * Format: date-time
             * @description A timestamp when this member was added to the team. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this team member relation. Set by the server.
             */
            readonly id?: number;
            /** @description The username of the member. */
            username?: string;
        };
        TeamProject: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TeamProject.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this relation was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this project <-> team relation.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The permission this team has on the project: 0 = Read only, 1 = Read & Write, 2 = Admin.
             * @default 0
             */
            permission: number;
            /**
             * Format: int64
             * @description The id of the team that gets access to the project.
             */
            team_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this relation was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        TeamReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TeamReadBody.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this team was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who created this team. Set by the server. */
            readonly created_by?: components["schemas"]["User"];
            description?: string;
            /** @description The team's external id, set by the openid or ldap provider that created it. Read-only for clients. */
            readonly external_id?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this team.
             */
            readonly id?: number;
            /** @description Whether the team should be publicly discoverable when sharing a project. Only effective if public teams are enabled on the instance. */
            is_public?: boolean;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this team (0=read, 2=admin). Teams have no write tier.
             */
            readonly max_permission?: number;
            /** @description All members of this team. Managed through the team members endpoints, not by writing to this field. */
            readonly members?: components["schemas"]["TeamUser"][] | null;
            /** @description The name of this team. */
            name?: string;
            /**
             * Format: date-time
             * @description A timestamp when this team was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        TeamUser: {
            admin?: boolean;
            /**
             * Format: int64
             * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
             */
            readonly bot_owner_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user's email address. Always empty for bot users. */
            email?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this user.
             */
            readonly id?: number;
            /** @description The full name of the user. */
            name?: string;
            /**
             * Format: date-time
             * @description A timestamp when this user was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
            username?: string;
        };
        TeamWithPermission: {
            /**
             * Format: date-time
             * @description A timestamp when this team was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who created this team. Set by the server. */
            readonly created_by?: components["schemas"]["User"];
            description?: string;
            /** @description The team's external id, set by the openid or ldap provider that created it. Read-only for clients. */
            readonly external_id?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this team.
             */
            readonly id?: number;
            /** @description Whether the team should be publicly discoverable when sharing a project. Only effective if public teams are enabled on the instance. */
            is_public?: boolean;
            /** @description All members of this team. Managed through the team members endpoints, not by writing to this field. */
            readonly members?: components["schemas"]["TeamUser"][] | null;
            /** @description The name of this team. */
            name?: string;
            /**
             * Format: int64
             * @description The permission this team has on the project: 0 = Read only, 1 = Read & Write, 2 = Admin.
             */
            readonly permission?: number;
            /**
             * Format: date-time
             * @description A timestamp when this team was last updated. You cannot change this value.
             */
            readonly updated?: string;
        };
        TimeEntry: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TimeEntry.json
             */
            readonly $schema?: string;
            /** @description An optional comment describing the logged time. */
            comment?: string;
            /**
             * Format: date-time
             * @description A timestamp when this time entry was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: date-time
             * @description When the tracked time ended. Null means a live timer is still running.
             */
            end_time?: string | null;
            /**
             * Format: int64
             * @description The unique, numeric id of this time entry.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The project this entry is attached to directly. Exactly one of task_id / project_id must be set.
             */
            project_id?: number;
            /**
             * Format: date-time
             * @description When the tracked time started.
             */
            start_time?: string;
            /**
             * Format: int64
             * @description The task this entry is attached to. Exactly one of task_id / project_id must be set.
             */
            task_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this time entry was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /**
             * Format: int64
             * @description The id of the user who logged this time entry. Set by the server.
             */
            readonly user_id?: number;
        };
        TimeEntryReadBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TimeEntryReadBody.json
             */
            readonly $schema?: string;
            /** @description An optional comment describing the logged time. */
            comment?: string;
            /**
             * Format: date-time
             * @description A timestamp when this time entry was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: date-time
             * @description When the tracked time ended. Null means a live timer is still running.
             */
            end_time?: string | null;
            /**
             * Format: int64
             * @description The unique, numeric id of this time entry.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The maximum permission the requesting user has on this time entry (0=read, 1=read/write, 2=admin).
             */
            readonly max_permission?: number;
            /**
             * Format: int64
             * @description The project this entry is attached to directly. Exactly one of task_id / project_id must be set.
             */
            project_id?: number;
            /**
             * Format: date-time
             * @description When the tracked time started.
             */
            start_time?: string;
            /**
             * Format: int64
             * @description The task this entry is attached to. Exactly one of task_id / project_id must be set.
             */
            task_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this time entry was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /**
             * Format: int64
             * @description The id of the user who logged this time entry. Set by the server.
             */
            readonly user_id?: number;
        };
        Token: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Token.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description A timestamp when this token was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this token.
             */
            readonly id?: number;
            /** @description The token in clear text. Only returned once when the token is created; never on subsequent reads. */
            readonly token?: string;
        };
        TokenRequest: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TokenRequest.json
             */
            readonly $schema?: string;
            client_id?: string;
            code?: string;
            code_verifier?: string;
            grant_type?: string;
            redirect_uri?: string;
            refresh_token?: string;
        };
        TokenResponse: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TokenResponse.json
             */
            readonly $schema?: string;
            access_token?: string;
            /** Format: int64 */
            expires_in?: number;
            refresh_token?: string;
            token_type?: string;
        };
        TokenTestBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TokenTestBodyBody.json
             */
            readonly $schema?: string;
            /** @description A static confirmation message. */
            readonly message?: string;
        };
        TotpDisableBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TotpDisableBodyBody.json
             */
            readonly $schema?: string;
            /** @description The current user's password, required to disable totp. */
            password?: string;
        };
        TotpEnableBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/TotpEnableBodyBody.json
             */
            readonly $schema?: string;
            /** @description The current totp passcode, used to confirm the authenticator is set up correctly. */
            passcode?: string;
        };
        User: {
            /**
             * Format: int64
             * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
             */
            readonly bot_owner_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user's email address. Always empty for bot users. */
            email?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this user.
             */
            readonly id?: number;
            /** @description The full name of the user. */
            name?: string;
            /**
             * Format: date-time
             * @description A timestamp when this user was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
            username?: string;
        };
        "User-change-passwordRequest": {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/User-change-passwordRequest.json
             */
            readonly $schema?: string;
            /** @description The new password. Max 72 bytes (a bcrypt limit), which may be fewer than 72 characters. */
            new_password?: string;
            /** @description The current password, for confirmation. */
            old_password?: string;
        };
        "User-update-emailRequest": {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/User-update-emailRequest.json
             */
            readonly $schema?: string;
            /** @description The new email address. */
            new_email?: string;
            /** @description The current password, for confirmation. */
            password?: string;
        };
        UserActionMessageBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/UserActionMessageBody.json
             */
            readonly $schema?: string;
            /** @description A confirmation message. */
            readonly message?: string;
        };
        UserAvatarProviderBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/UserAvatarProviderBody.json
             */
            readonly $schema?: string;
            /** @description The avatar provider. One of: gravatar (uses the user email), upload, initials, marble (random per user), ldap (synced from LDAP), openid (synced from OpenID), default. */
            avatar_provider?: string;
        };
        UserDeletionConfirmBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/UserDeletionConfirmBodyBody.json
             */
            readonly $schema?: string;
            /** @description The deletion confirmation token from the email sent by the request-deletion endpoint. */
            token: string;
        };
        UserDeletionPasswordBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/UserDeletionPasswordBodyBody.json
             */
            readonly $schema?: string;
            /** @description The authenticated user's password. Required for local users; ignored for users authenticated via an external provider. */
            password?: string;
        };
        UserExportPasswordBodyBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/UserExportPasswordBodyBody.json
             */
            readonly $schema?: string;
            /** @description The authenticated user's password. Required for local users; ignored for users authenticated via an external provider. */
            password?: string;
        };
        UserExportStatus: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/UserExportStatus.json
             */
            readonly $schema?: string;
            /**
             * Format: date-time
             * @description When the export was created.
             */
            readonly created?: string;
            /**
             * Format: date-time
             * @description When the export will be automatically deleted (7 days after creation).
             */
            readonly expires?: string;
            /**
             * Format: int64
             * @description The id of the export file.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The size of the export file in bytes.
             */
            readonly size?: number;
        };
        UserGeneralSettings: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/UserGeneralSettings.json
             */
            readonly $schema?: string;
            /**
             * Format: int64
             * @description Project a task is filed under when created without an explicit project.
             */
            default_project_id?: number;
            /** @description If true, the user can be found when searching for their exact email. */
            discoverable_by_email?: boolean;
            /** @description If true, this user can be found by their name or parts of it when searching. */
            discoverable_by_name?: boolean;
            /** @description If enabled, sends email reminders of tasks to the user. */
            email_reminders_enabled?: boolean;
            /** @description Additional settings links provided by the OpenID provider. Server-controlled. */
            readonly extra_settings_links?: {
                [key: string]: unknown;
            };
            /** @description Arbitrary settings used only by the frontend. Any JSON value; stored and returned verbatim. */
            frontend_settings?: unknown;
            /** @description The user's language. */
            language?: string;
            /** @description The full name of the user. */
            name?: string;
            /** @description If enabled, the user gets an email for their overdue tasks each morning. */
            overdue_tasks_reminders_enabled?: boolean;
            /** @description The time the daily overdue-tasks summary is sent, as HH:MM. */
            overdue_tasks_reminders_time?: string;
            /** @description The user's time zone, used to send task reminders in their local time. */
            timezone?: string;
            /**
             * Format: int64
             * @description The day the week starts on: 0=sunday, 1=monday, … 6=saturday.
             */
            week_start?: number;
        };
        UserInfoBody: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/UserInfoBody.json
             */
            readonly $schema?: string;
            /** @description The name of the source the user authenticated with: 'local', 'ldap', or the configured OpenID provider name. */
            readonly auth_provider?: string;
            /**
             * Format: int64
             * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
             */
            readonly bot_owner_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was created. You cannot change this value.
             */
            readonly created?: string;
            /**
             * Format: date-time
             * @description When the account is scheduled for deletion, if a deletion was requested.
             */
            readonly deletion_scheduled_at?: string;
            /** @description The user's email address. Always empty for bot users. */
            email?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this user.
             */
            readonly id?: number;
            /** @description True if the user is an instance administrator. */
            readonly is_admin?: boolean;
            /** @description True if the user authenticates locally (not via LDAP or OpenID). */
            readonly is_local_user?: boolean;
            /** @description The full name of the user. */
            name?: string;
            /** @description The current user's settings. */
            readonly settings?: components["schemas"]["UserGeneralSettings"];
            /**
             * Format: date-time
             * @description A timestamp when this user was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
            username?: string;
        };
        UserWithPermission: {
            /**
             * Format: int64
             * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
             */
            readonly bot_owner_id?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user's email address. Always empty for bot users. */
            email?: string;
            /**
             * Format: int64
             * @description The unique, numeric id of this user.
             */
            readonly id?: number;
            /** @description The full name of the user. */
            name?: string;
            /**
             * Format: int64
             * @description The permission this user has on the project. 0 = Read only, 1 = Read & Write, 2 = Admin.
             */
            readonly permission?: number;
            /**
             * Format: date-time
             * @description A timestamp when this user was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
            username?: string;
        };
        VikunjaErrorModel: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/VikunjaErrorModel.json
             */
            readonly $schema?: string;
            /**
             * Format: int64
             * @description Vikunja numeric error code; see https://vikunja.io/docs/errors/
             */
            readonly code?: number;
            /**
             * @description A human-readable explanation specific to this occurrence of the problem.
             * @example Property foo is required but is missing.
             */
            detail?: string;
            /** @description Optional list of individual error details */
            errors?: components["schemas"]["ErrorDetail"][] | null;
            /** @description Dynamic values referenced by the error message, keyed by translation placeholder name, for client-side localisation. */
            readonly i18n_params?: {
                [key: string]: string;
            };
            /**
             * Format: uri
             * @description A URI reference that identifies the specific occurrence of the problem.
             * @example https://example.com/error-log/abc123
             */
            instance?: string;
            /**
             * Format: int64
             * @description HTTP status code
             * @example 400
             */
            status?: number;
            /**
             * @description A short, human-readable summary of the problem type. This value should not change between occurrences of the error.
             * @example Bad Request
             */
            title?: string;
            /**
             * Format: uri
             * @description A URI reference to human-readable documentation for the error.
             * @default about:blank
             * @example https://example.com/errors/example
             */
            type: string;
        };
        VikunjaInfos: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/VikunjaInfos.json
             */
            readonly $schema?: string;
            /** @description Whether users may change project icons. */
            allow_icon_changes?: boolean;
            /** @description The authentication methods enabled on this instance. */
            auth?: components["schemas"]["AuthInfo"];
            /** @description The migrators enabled on this instance. */
            available_migrators?: string[] | null;
            /** @description Whether the CalDAV interface is enabled. */
            caldav_enabled?: boolean;
            /** @description Whether the configured database supports concurrent writes. False on SQLite; clients should serialize batched writes when this is false. */
            concurrent_writes?: boolean;
            /** @description Whether this instance runs in demo mode (data is periodically reset). */
            demo_mode_enabled?: boolean;
            /** @description Whether email reminders are enabled. */
            email_reminders_enabled?: boolean;
            /** @description The project-background providers enabled on this instance (e.g. upload, unsplash). */
            enabled_background_providers?: string[] | null;
            /** @description The licensed pro features enabled on this instance. */
            enabled_pro_features?: number[] | null;
            /** @description The publicly configured frontend URL of this instance. */
            frontend_url?: string;
            /** @description Links to the instance's legal documents. */
            legal?: components["schemas"]["LegalInfo"];
            /** @description Whether sharing projects via public links is enabled. */
            link_sharing_enabled?: boolean;
            /** @description The maximum allowed upload size, as a human-readable string (e.g. 20MB). */
            max_file_size?: string;
            /**
             * Format: int64
             * @description The maximum number of items a paginated endpoint returns per page.
             */
            max_items_per_page?: number;
            /** @description The message of the day, shown to all users. */
            motd?: string;
            /** @description Whether public teams are enabled. */
            public_teams_enabled?: boolean;
            /** @description Whether task attachments are enabled. */
            task_attachments_enabled?: boolean;
            /** @description Whether task comments are enabled. */
            task_comments_enabled?: boolean;
            /** @description Whether TOTP two-factor authentication is enabled. */
            totp_enabled?: boolean;
            /** @description Whether users may delete their own account. */
            user_deletion_enabled?: boolean;
            /** @description The Vikunja version this instance runs. */
            version?: string;
            /** @description Whether webhooks are enabled. */
            webhooks_enabled?: boolean;
        };
        Webhook: {
            /**
             * Format: uri
             * @description A URL to the JSON Schema for this object.
             * @example /api/v2/schemas/Webhook.json
             */
            readonly $schema?: string;
            /** @description The password for the Basic Auth header. Write-only: never returned in responses. */
            basic_auth_password?: string;
            /** @description If provided together with basic_auth_password, webhook requests will be sent with a Basic Auth header. Write-only: never returned in responses. */
            basic_auth_user?: string;
            /**
             * Format: date-time
             * @description A timestamp when this webhook target was created. You cannot change this value.
             */
            readonly created?: string;
            /** @description The user who initially created the webhook target. */
            readonly created_by?: components["schemas"]["User"];
            /** @description The webhook events which should fire this webhook target. Get the available events from /api/v1/webhooks/events. */
            events?: string[] | null;
            /**
             * Format: int64
             * @description The generated ID of this webhook target.
             */
            readonly id?: number;
            /**
             * Format: int64
             * @description The id of the project this webhook target belongs to. Set from the URL, not the body.
             */
            readonly project_id?: number;
            /** @description If provided, webhook requests will be signed using HMAC. See https://vikunja.io/docs/webhooks/#signing. Write-only: never returned in responses. */
            secret?: string;
            /** @description The target URL where the POST request with the webhook payload will be made. */
            target_url?: string;
            /**
             * Format: date-time
             * @description A timestamp when this webhook target was last updated. You cannot change this value.
             */
            readonly updated?: string;
            /**
             * Format: int64
             * @description The id of the user if this is a user-level webhook (mutually exclusive with project_id).
             */
            readonly user_id?: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    "admin-overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Overview"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "admin-projects-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedProject"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "admin-projects-patch-owner": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric ID of the project. */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminOwnerPatchBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "admin-users-create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateUserBody"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "admin-users-delete": {
        parameters: {
            query?: {
                /** @description 'now' deletes immediately; 'scheduled' (the default) triggers the email-confirmation self-deletion flow. */
                mode?: string;
            };
            header?: never;
            path: {
                /** @description The numeric ID of the user. */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "admin-users-patch-admin": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric ID of the user. */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminIsAdminPatchBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "admin-users-set-password": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric ID of the user. */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminSetPasswordBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "admin-users-password-reset-email": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric ID of the user. */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "admin-users-patch-status": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric ID of the user. */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminStatusPatchBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "avatar-get": {
        parameters: {
            query?: {
                /** @description Desired avatar edge length in pixels. Clamped to the server's configured maximum if larger; providers that render fixed-size images may ignore it. */
                size?: number;
            };
            header?: never;
            path: {
                /** @description The username of the user whose avatar to fetch. */
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The avatar image bytes. The Content-Type header carries the actual image type. */
            200: {
                headers: {
                    "Content-Type"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "filters-create": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedFilter"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedFilter"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "filters-read": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                filter: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedFilterReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "filters-update": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                filter: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedFilterReadBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedFilter"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "filters-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                filter: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-filters-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                filter: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/SavedFilterReadBody.json
                     */
                    readonly $schema?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this filter was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The description of the filter. */
                    description?: string;
                    /** @description The task filter query and collection options this saved filter wraps. */
                    filters?: unknown;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this saved filter.
                     */
                    readonly id?: number;
                    /** @description If true, the filter shows up in the Favorites pseudo-project alongside favorite projects. */
                    is_favorite?: boolean;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this saved filter (0=read, 1=read/write, 2=admin). Filters are owner-only, so this is always 2 for a successful read.
                     */
                    readonly max_permission?: number;
                    /** @description The user who owns this filter; set by the server. */
                    readonly owner?: unknown;
                    /** @description The title of the filter. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this filter was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/SavedFilterReadBody.json
                     */
                    readonly $schema?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this filter was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The description of the filter. */
                    description?: string;
                    /** @description The task filter query and collection options this saved filter wraps. */
                    filters?: unknown;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this saved filter.
                     */
                    readonly id?: number;
                    /** @description If true, the filter shows up in the Favorites pseudo-project alongside favorite projects. */
                    is_favorite?: boolean;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this saved filter (0=read, 1=read/write, 2=admin). Filters are owner-only, so this is always 2 for a successful read.
                     */
                    readonly max_permission?: number;
                    /** @description The user who owns this filter; set by the server. */
                    readonly owner?: unknown;
                    /** @description The title of the filter. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this filter was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedFilter"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    info: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VikunjaInfos"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "labels-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedLabelWithTaskID"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "labels-create": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Label"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Label"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "labels-read": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "labels-update": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabelReadBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Label"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "labels-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-labels-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/LabelReadBody.json
                     */
                    readonly $schema?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this label was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The user who created this label. */
                    readonly created_by?: unknown;
                    /** @description The label description. */
                    description?: string;
                    /** @description The color this label has in hex format. */
                    hex_color?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this label.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this label (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /** @description The title of the label. You'll see this one on tasks associated with it. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this label was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/LabelReadBody.json
                     */
                    readonly $schema?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this label was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The user who created this label. */
                    readonly created_by?: unknown;
                    /** @description The label description. */
                    description?: string;
                    /** @description The color this label has in hex format. */
                    hex_color?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this label.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this label (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /** @description The title of the label. You'll see this one on tasks associated with it. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this label was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Label"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "auth-login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Login"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthTokenBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "auth-logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LogoutBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-csv-detect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The CSV file to analyze.
                     */
                    import: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DetectionResult"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-csv-migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /** @description The import configuration as a JSON object (see the ImportConfig schema), passed as a multipart form value. Obtain a starting config from the detect endpoint. */
                    config: string;
                    /**
                     * Format: binary
                     * @description The CSV file to import.
                     */
                    import: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MigrationStartedBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-csv-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /** @description The import configuration as a JSON object (see the ImportConfig schema), passed as a multipart form value. Obtain a starting config from the detect endpoint. */
                    config: string;
                    /**
                     * Format: binary
                     * @description The CSV file to import.
                     */
                    import: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreviewResult"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-csv-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Status"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-ticktick-migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The export file to import. Its expected format depends on the migrator (e.g. a Vikunja export zip, a TickTick CSV, a WeKan JSON export).
                     */
                    import: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MigrationStartedBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-ticktick-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Status"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-vikunja-file-migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The export file to import. Its expected format depends on the migrator (e.g. a Vikunja export zip, a TickTick CSV, a WeKan JSON export).
                     */
                    import: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MigrationStartedBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-vikunja-file-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Status"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-wekan-migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The export file to import. Its expected format depends on the migrator (e.g. a Vikunja export zip, a TickTick CSV, a WeKan JSON export).
                     */
                    import: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MigrationStartedBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "migration-wekan-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Status"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "notifications-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedDatabaseNotification"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "notifications-mark-all-read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MarkAllReadBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "notifications-atom-feed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The notifications Atom feed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/atom+xml": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "notifications-mark-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                notificationid: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DatabaseNotifications"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseNotifications"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "oauth-authorize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthorizeRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthorizeResponse"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "oauth-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/x-www-form-urlencoded": components["schemas"]["TokenRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description If set to "permissions", each returned project includes the max permission the requesting user has on it (max_permission). Currently only "permissions" is supported. */
                expand?: "permissions";
                /** @description If true, also returns archived projects. */
                is_archived?: boolean;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedProject"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-create": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Project"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-read": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-update": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectReadBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-projects-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/ProjectReadBody.json
                     */
                    readonly $schema?: string;
                    /** @description A small BlurHash preview of the project background, shown until the real background loads. See https://blurha.sh/. */
                    readonly background_blur_hash?: string;
                    /** @description Extra information about the background (e.g. attribution). When not null, the background is available at /projects/{projectID}/background. */
                    readonly background_information?: unknown;
                    /**
                     * Format: date-time
                     * @description A timestamp when this project was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The description of the project. */
                    description?: string;
                    /** @description The hex color of this project, without the leading #. */
                    hex_color?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this project.
                     */
                    readonly id?: number;
                    /** @description The unique project short identifier. Used to build task identifiers (e.g. PROJ-123). */
                    identifier?: string;
                    /** @description Whether the project is archived. Archived projects are read-only. */
                    is_archived?: boolean;
                    /** @description Whether the project is a favorite of the requesting user. This value is per-user and depends on who makes the call. */
                    is_favorite?: boolean;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this project (0 = read, 1 = read/write, 2 = admin).
                     */
                    readonly max_permission?: number;
                    /** @description The user who owns this project. Set by the server; ignored on write. */
                    readonly owner?: unknown;
                    /**
                     * Format: int64
                     * @description The id of the parent project. 0 or omitted for a top-level project. Sending an explicit 0 detaches the project to the top level and requires admin permission.
                     */
                    parent_project_id?: number;
                    /**
                     * Format: double
                     * @description The position of this project when listing all projects. See the tasks.position property for how positions work.
                     */
                    position?: number;
                    /** @description The requesting user's subscription status for this project. Read-only here; use the subscription endpoints to change it. Only returned when retrieving a single project. */
                    readonly subscription?: unknown;
                    /** @description The title of the project. You'll see this in the overview. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this project was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                    /** @description The views configured for this project. Managed through the project view endpoints. */
                    readonly views?: unknown[];
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/ProjectReadBody.json
                     */
                    readonly $schema?: string;
                    /** @description A small BlurHash preview of the project background, shown until the real background loads. See https://blurha.sh/. */
                    readonly background_blur_hash?: string;
                    /** @description Extra information about the background (e.g. attribution). When not null, the background is available at /projects/{projectID}/background. */
                    readonly background_information?: unknown;
                    /**
                     * Format: date-time
                     * @description A timestamp when this project was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The description of the project. */
                    description?: string;
                    /** @description The hex color of this project, without the leading #. */
                    hex_color?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this project.
                     */
                    readonly id?: number;
                    /** @description The unique project short identifier. Used to build task identifiers (e.g. PROJ-123). */
                    identifier?: string;
                    /** @description Whether the project is archived. Archived projects are read-only. */
                    is_archived?: boolean;
                    /** @description Whether the project is a favorite of the requesting user. This value is per-user and depends on who makes the call. */
                    is_favorite?: boolean;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this project (0 = read, 1 = read/write, 2 = admin).
                     */
                    readonly max_permission?: number;
                    /** @description The user who owns this project. Set by the server; ignored on write. */
                    readonly owner?: unknown;
                    /**
                     * Format: int64
                     * @description The id of the parent project. 0 or omitted for a top-level project. Sending an explicit 0 detaches the project to the top level and requires admin permission.
                     */
                    parent_project_id?: number;
                    /**
                     * Format: double
                     * @description The position of this project when listing all projects. See the tasks.position property for how positions work.
                     */
                    position?: number;
                    /** @description The requesting user's subscription status for this project. Read-only here; use the subscription endpoints to change it. Only returned when retrieving a single project. */
                    readonly subscription?: unknown;
                    /** @description The title of the project. You'll see this in the overview. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this project was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                    /** @description The views configured for this project. Managed through the project view endpoints. */
                    readonly views?: unknown[];
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-time-entries-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                project_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTimeEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric id of the project to duplicate. */
                projectid: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectDuplicate"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectDuplicate"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-background-get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The id of the project whose background to fetch. */
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The project background as a jpeg image. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-background-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-background-upload": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The id of the project to set the background on. */
                project: number;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The background image to upload. Must be a decodable raster image (JPEG, PNG, GIF, BMP, TIFF or WebP); it is resized server-side and re-encoded as JPEG.
                     */
                    background: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "shares-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedLinkSharing"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "shares-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LinkSharing"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkSharing"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "shares-read": {
        parameters: {
            query?: never;
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                project: number;
                share: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkShareReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "shares-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                share: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-tasks-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description Filter query to match tasks by. See https://vikunja.io/docs/filters. */
                filter?: string;
                /** @description Timezone used to resolve relative date filters like "now". */
                filter_timezone?: string;
                /** @description If true, also include tasks whose filtered field is null. */
                filter_include_nulls?: boolean;
                /** @description Fields to sort by (e.g. done, priority). Repeatable; pair positionally with order_by. The special value relevance sorts by search relevance (most relevant first, requires s; ignored when the database cannot score the query). */
                sort_by?: string[] | null;
                /** @description Sort order per sort_by field, asc or desc. Repeatable; defaults to asc. */
                order_by?: string[] | null;
                /** @description Embed extra, more expensive data per task. Repeatable. */
                expand?: ("subtasks" | "buckets" | "reactions" | "comments" | "comment_count" | "time_entries_count" | "is_unread")[] | null;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                /** @description The numeric id of the project. */
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTask"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-create": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                /** @description The numeric id of the project to create the task in. */
                project: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Task"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-read-by-index": {
        parameters: {
            query?: {
                /** @description Embed extra data per task. Repeatable. */
                expand?: ("subtasks" | "buckets" | "reactions" | "comments" | "comment_count" | "time_entries_count" | "is_unread")[] | null;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                /** @description A numeric project id or a textual project identifier (e.g. "PROJ"). */
                project: string;
                /** @description The per-project task index. */
                index: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskReadOneBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-teams-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTeamWithPermission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-teams-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TeamProject"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TeamProject"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-teams-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                team: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TeamProject"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TeamProject"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-teams-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                team: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-users-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUserWithPermission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-users-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectUser"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "projects-users-search": {
        parameters: {
            query?: {
                /** @description Search query matched against username and name. */
                q?: string;
            };
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-users-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                user: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectUser"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-users-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                user: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-views-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedProjectView"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-views-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectView"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectView"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-views-read": {
        parameters: {
            query?: never;
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                project: number;
                view: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectViewReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-views-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                view: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectViewReadBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectView"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-views-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                view: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-project-views-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                view: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/ProjectViewReadBody.json
                     */
                    readonly $schema?: string;
                    /** @description When the bucket configuration mode is filter, holds the title and filter of each bucket. */
                    bucket_configuration?: unknown[];
                    /**
                     * @description The bucket configuration mode. One of none, manual or filter. manual lets you move tasks between buckets; filter creates a bucket per filter.
                     * @enum {string}
                     */
                    bucket_configuration_mode?: "none" | "manual" | "filter";
                    /**
                     * Format: date-time
                     * @description A timestamp when this view was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /**
                     * Format: int64
                     * @description The id of the bucket new tasks without a bucket are added to. Defaults to the leftmost bucket.
                     */
                    default_bucket_id?: number;
                    /**
                     * Format: int64
                     * @description The id of the done bucket. Tasks moved here are marked done, and tasks marked done are moved here.
                     */
                    done_bucket_id?: number;
                    /** @description The filter query used to match tasks shown in this view. See https://vikunja.io/docs/filters. */
                    filter?: unknown;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this view. Set by the server.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this view (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /**
                     * Format: double
                     * @description The position of this view in the project's list of views. Views are sorted ascending by this value.
                     */
                    position?: number;
                    /**
                     * Format: int64
                     * @description The project this view belongs to. Taken from the URL path; ignored on write.
                     */
                    readonly project_id?: number;
                    /** @description The title of this view. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this view was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                    /**
                     * @description The kind of this view. One of list, gantt, table or kanban.
                     * @enum {string}
                     */
                    view_kind?: "list" | "gantt" | "table" | "kanban";
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/ProjectViewReadBody.json
                     */
                    readonly $schema?: string;
                    /** @description When the bucket configuration mode is filter, holds the title and filter of each bucket. */
                    bucket_configuration?: unknown[];
                    /**
                     * @description The bucket configuration mode. One of none, manual or filter. manual lets you move tasks between buckets; filter creates a bucket per filter.
                     * @enum {string}
                     */
                    bucket_configuration_mode?: "none" | "manual" | "filter";
                    /**
                     * Format: date-time
                     * @description A timestamp when this view was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /**
                     * Format: int64
                     * @description The id of the bucket new tasks without a bucket are added to. Defaults to the leftmost bucket.
                     */
                    default_bucket_id?: number;
                    /**
                     * Format: int64
                     * @description The id of the done bucket. Tasks moved here are marked done, and tasks marked done are moved here.
                     */
                    done_bucket_id?: number;
                    /** @description The filter query used to match tasks shown in this view. See https://vikunja.io/docs/filters. */
                    filter?: unknown;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this view. Set by the server.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this view (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /**
                     * Format: double
                     * @description The position of this view in the project's list of views. Views are sorted ascending by this value.
                     */
                    position?: number;
                    /**
                     * Format: int64
                     * @description The project this view belongs to. Taken from the URL path; ignored on write.
                     */
                    readonly project_id?: number;
                    /** @description The title of this view. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this view was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                    /**
                     * @description The kind of this view. One of list, gantt, table or kanban.
                     * @enum {string}
                     */
                    view_kind?: "list" | "gantt" | "table" | "kanban";
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectView"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "buckets-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                project: number;
                view: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedBucket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "buckets-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                view: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Bucket"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Bucket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-view-buckets-tasks-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description Filter query to match tasks by. See https://vikunja.io/docs/filters. */
                filter?: string;
                /** @description Timezone used to resolve relative date filters like "now". */
                filter_timezone?: string;
                /** @description If true, also include tasks whose filtered field is null. */
                filter_include_nulls?: boolean;
                /** @description Fields to sort by (e.g. done, priority). Repeatable; pair positionally with order_by. The special value relevance sorts by search relevance (most relevant first, requires s; ignored when the database cannot score the query). */
                sort_by?: string[] | null;
                /** @description Sort order per sort_by field, asc or desc. Repeatable; defaults to asc. */
                order_by?: string[] | null;
                /** @description Embed extra, more expensive data per task. Repeatable. */
                expand?: ("subtasks" | "buckets" | "reactions" | "comments" | "comment_count" | "time_entries_count" | "is_unread")[] | null;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                /** @description The numeric id of the project. */
                project: number;
                /** @description The numeric id of the project view. */
                view: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BucketsWithTasksBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "buckets-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                view: number;
                bucket: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Bucket"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Bucket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "buckets-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                view: number;
                bucket: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-bucket-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                view: number;
                bucket: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskBucket"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskBucket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "project-view-tasks-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description Filter query to match tasks by. See https://vikunja.io/docs/filters. */
                filter?: string;
                /** @description Timezone used to resolve relative date filters like "now". */
                filter_timezone?: string;
                /** @description If true, also include tasks whose filtered field is null. */
                filter_include_nulls?: boolean;
                /** @description Fields to sort by (e.g. done, priority). Repeatable; pair positionally with order_by. The special value relevance sorts by search relevance (most relevant first, requires s; ignored when the database cannot score the query). */
                sort_by?: string[] | null;
                /** @description Sort order per sort_by field, asc or desc. Repeatable; defaults to asc. */
                order_by?: string[] | null;
                /** @description Embed extra, more expensive data per task. Repeatable. */
                expand?: ("subtasks" | "buckets" | "reactions" | "comments" | "comment_count" | "time_entries_count" | "is_unread")[] | null;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                /** @description The numeric id of the project. */
                project: number;
                /** @description The numeric id of the project view. */
                view: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTask"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "webhooks-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedWebhook"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "webhooks-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Webhook"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Webhook"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "webhooks-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                webhook: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Webhook"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Webhook"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "webhooks-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project: number;
                webhook: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "token-routes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: {
                            [key: string]: components["schemas"]["RouteDetail"];
                        };
                    };
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "auth-link-share": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The public hash of the link share. */
                share: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["Auth-link-shareRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkShareToken"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "subscriptions-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The kind of entity to (un)subscribe from. Either project or task. */
                entity: "project" | "task";
                /** @description The numeric id of the entity to (un)subscribe from. */
                entityID: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Subscription"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "subscriptions-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The kind of entity to (un)subscribe from. Either project or task. */
                entity: "project" | "task";
                /** @description The numeric id of the entity to (un)subscribe from. */
                entityID: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description Filter query to match tasks by. See https://vikunja.io/docs/filters. */
                filter?: string;
                /** @description Timezone used to resolve relative date filters like "now". */
                filter_timezone?: string;
                /** @description If true, also include tasks whose filtered field is null. */
                filter_include_nulls?: boolean;
                /** @description Fields to sort by (e.g. done, priority). Repeatable; pair positionally with order_by. The special value relevance sorts by search relevance (most relevant first, requires s; ignored when the database cannot score the query). */
                sort_by?: string[] | null;
                /** @description Sort order per sort_by field, asc or desc. Repeatable; defaults to asc. */
                order_by?: string[] | null;
                /** @description Embed extra, more expensive data per task. Repeatable. */
                expand?: ("subtasks" | "buckets" | "reactions" | "comments" | "comment_count" | "time_entries_count" | "is_unread")[] | null;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTask"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-bulk-update": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkTask"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkTask"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-read": {
        parameters: {
            query?: {
                /** @description Embed extra data per task. Repeatable. */
                expand?: ("subtasks" | "buckets" | "reactions" | "comments" | "comment_count" | "time_entries_count" | "is_unread")[] | null;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                /** @description The numeric id of the task. */
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskReadOneBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-update": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskReadOneBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-tasks-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/TaskReadOneBody.json
                     */
                    readonly $schema?: string;
                    /** @description The users assigned to this task. Read-only here; use the task-assignee endpoints to change assignments. */
                    readonly assignees?: unknown[];
                    /** @description The task's attachments. Read-only here; use the attachment endpoints to add or remove them. */
                    readonly attachments?: unknown[];
                    /**
                     * Format: int64
                     * @description The bucket the task is in. Only populated when the task is accessed via a view with buckets. To move a task between buckets, the new bucket must be in the same view as the old one.
                     */
                    bucket_id?: number;
                    /** @description The task's buckets across all views. Only present when requested via the buckets expand option. */
                    readonly buckets?: unknown[];
                    /**
                     * Format: int64
                     * @description The number of comments on this task. Only present when requested via the comment_count expand option.
                     */
                    readonly comment_count?: number;
                    /** @description The task's first 50 comments. Only present when requested via the comments expand option. */
                    readonly comments?: unknown[];
                    /**
                     * Format: int64
                     * @description The id of the attachment used as this task's cover image, or 0 for none.
                     */
                    cover_image_attachment_id?: number;
                    /**
                     * Format: date-time
                     * @description When this task was created. Set by the server; ignored on write.
                     */
                    readonly created?: string;
                    /** @description The user who created this task. Set by the server. */
                    readonly created_by?: unknown;
                    /**
                     * Format: date-time
                     * @description When this task was soft-deleted. Soft-deleted tasks are kept for 30 days before they are removed permanently.
                     */
                    readonly deleted_at?: string;
                    description?: string;
                    done?: boolean;
                    /**
                     * Format: date-time
                     * @description When the task was marked as done. Set by the server; ignored on write.
                     */
                    readonly done_at?: string;
                    /** Format: date-time */
                    due_date?: string;
                    /** Format: date-time */
                    end_date?: string;
                    /** @description The task color as a hex string without the leading '#'. */
                    hex_color?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this task.
                     */
                    readonly id?: number;
                    /** @description The textual task identifier, derived from the project identifier and the task index (e.g. "PROJ-12"). */
                    readonly identifier?: string;
                    /**
                     * Format: int64
                     * @description The per-project task index, assigned by the server.
                     */
                    readonly index?: number;
                    /** @description Whether the requesting user has favorited this task. Per-user, so it differs between callers. */
                    is_favorite?: boolean;
                    /** @description Whether the task is unread for the requesting user. Only present when requested via the is_unread expand option. */
                    readonly is_unread?: boolean;
                    /** @description The labels on this task. Read-only here; use the label-task endpoints to add or remove labels. */
                    readonly labels?: unknown[];
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this task (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /**
                     * Format: double
                     * @description How far the task is from done, between 0 and 1.
                     */
                    percent_done?: number;
                    /**
                     * Format: double
                     * @description The task's position, saved per view. Only non-zero when the task is fetched through a view endpoint; use the task-position endpoint to change it.
                     */
                    readonly position?: number;
                    /** Format: int64 */
                    priority?: number;
                    /**
                     * Format: int64
                     * @description The id of the project this task belongs to. On create it is taken from the URL; on update, setting it to a different project moves the task (requires write access to the target project).
                     */
                    project_id?: number;
                    /** @description Reactions on this task. Only present when requested via the reactions expand option. */
                    readonly reactions?: {
                        [key: string]: components["schemas"]["User"][] | null;
                    };
                    /** @description Related tasks grouped by relation kind. Read-only here; use the task-relation endpoints to change relations. */
                    readonly related_tasks?: {
                        [key: string]: components["schemas"]["Task"][] | null;
                    };
                    reminders?: unknown[];
                    /**
                     * Format: int64
                     * @description The interval in seconds this task repeats. When set, marking the task done re-opens it and bumps its reminders and due date by this amount.
                     */
                    repeat_after?: number;
                    /**
                     * Format: int64
                     * @description How the task repeats when marked done: 0 = after repeat_after seconds, 1 = monthly (ignores repeat_after), 2 = from the current date rather than the last set date.
                     */
                    repeat_mode?: number;
                    /** Format: date-time */
                    start_date?: string;
                    /** @description The requesting user's subscription to this task. Read-only here; use the subscription endpoints to change it. Only present when reading a single task. */
                    readonly subscription?: unknown;
                    /**
                     * Format: int64
                     * @description The number of time entries on this task. Only present when requested via the time_entries_count expand option.
                     */
                    readonly time_entries_count?: number;
                    /** @description The task title. This is what you'll see in the project. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description When this task was last updated. Set by the server; ignored on write.
                     */
                    readonly updated?: string;
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/TaskReadOneBody.json
                     */
                    readonly $schema?: string;
                    /** @description The users assigned to this task. Read-only here; use the task-assignee endpoints to change assignments. */
                    readonly assignees?: unknown[];
                    /** @description The task's attachments. Read-only here; use the attachment endpoints to add or remove them. */
                    readonly attachments?: unknown[];
                    /**
                     * Format: int64
                     * @description The bucket the task is in. Only populated when the task is accessed via a view with buckets. To move a task between buckets, the new bucket must be in the same view as the old one.
                     */
                    bucket_id?: number;
                    /** @description The task's buckets across all views. Only present when requested via the buckets expand option. */
                    readonly buckets?: unknown[];
                    /**
                     * Format: int64
                     * @description The number of comments on this task. Only present when requested via the comment_count expand option.
                     */
                    readonly comment_count?: number;
                    /** @description The task's first 50 comments. Only present when requested via the comments expand option. */
                    readonly comments?: unknown[];
                    /**
                     * Format: int64
                     * @description The id of the attachment used as this task's cover image, or 0 for none.
                     */
                    cover_image_attachment_id?: number;
                    /**
                     * Format: date-time
                     * @description When this task was created. Set by the server; ignored on write.
                     */
                    readonly created?: string;
                    /** @description The user who created this task. Set by the server. */
                    readonly created_by?: unknown;
                    /**
                     * Format: date-time
                     * @description When this task was soft-deleted. Soft-deleted tasks are kept for 30 days before they are removed permanently.
                     */
                    readonly deleted_at?: string;
                    description?: string;
                    done?: boolean;
                    /**
                     * Format: date-time
                     * @description When the task was marked as done. Set by the server; ignored on write.
                     */
                    readonly done_at?: string;
                    /** Format: date-time */
                    due_date?: string;
                    /** Format: date-time */
                    end_date?: string;
                    /** @description The task color as a hex string without the leading '#'. */
                    hex_color?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this task.
                     */
                    readonly id?: number;
                    /** @description The textual task identifier, derived from the project identifier and the task index (e.g. "PROJ-12"). */
                    readonly identifier?: string;
                    /**
                     * Format: int64
                     * @description The per-project task index, assigned by the server.
                     */
                    readonly index?: number;
                    /** @description Whether the requesting user has favorited this task. Per-user, so it differs between callers. */
                    is_favorite?: boolean;
                    /** @description Whether the task is unread for the requesting user. Only present when requested via the is_unread expand option. */
                    readonly is_unread?: boolean;
                    /** @description The labels on this task. Read-only here; use the label-task endpoints to add or remove labels. */
                    readonly labels?: unknown[];
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this task (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /**
                     * Format: double
                     * @description How far the task is from done, between 0 and 1.
                     */
                    percent_done?: number;
                    /**
                     * Format: double
                     * @description The task's position, saved per view. Only non-zero when the task is fetched through a view endpoint; use the task-position endpoint to change it.
                     */
                    readonly position?: number;
                    /** Format: int64 */
                    priority?: number;
                    /**
                     * Format: int64
                     * @description The id of the project this task belongs to. On create it is taken from the URL; on update, setting it to a different project moves the task (requires write access to the target project).
                     */
                    project_id?: number;
                    /** @description Reactions on this task. Only present when requested via the reactions expand option. */
                    readonly reactions?: {
                        [key: string]: components["schemas"]["User"][] | null;
                    };
                    /** @description Related tasks grouped by relation kind. Read-only here; use the task-relation endpoints to change relations. */
                    readonly related_tasks?: {
                        [key: string]: components["schemas"]["Task"][] | null;
                    };
                    reminders?: unknown[];
                    /**
                     * Format: int64
                     * @description The interval in seconds this task repeats. When set, marking the task done re-opens it and bumps its reminders and due date by this amount.
                     */
                    repeat_after?: number;
                    /**
                     * Format: int64
                     * @description How the task repeats when marked done: 0 = after repeat_after seconds, 1 = monthly (ignores repeat_after), 2 = from the current date rather than the last set date.
                     */
                    repeat_mode?: number;
                    /** Format: date-time */
                    start_date?: string;
                    /** @description The requesting user's subscription to this task. Read-only here; use the subscription endpoints to change it. Only present when reading a single task. */
                    readonly subscription?: unknown;
                    /**
                     * Format: int64
                     * @description The number of time entries on this task. Only present when requested via the time_entries_count expand option.
                     */
                    readonly time_entries_count?: number;
                    /** @description The task title. This is what you'll see in the project. */
                    title?: string;
                    /**
                     * Format: date-time
                     * @description When this task was last updated. Set by the server; ignored on write.
                     */
                    readonly updated?: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Task"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-assignees-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-assignees-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskAssginee"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskAssginee"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-assignees-bulk": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAssignees"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkAssignees"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-assignees-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projecttask: number;
                user: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric id of the task to duplicate. */
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDuplicate"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-labels-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedLabelWithTaskID"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-labels-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabelTask"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelTask"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-labels-bulk-replace": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric id of the task whose labels to replace. */
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabelTaskBulk"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelTaskBulk"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-labels-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projecttask: number;
                label: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-mark-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric id of the task to mark as read. */
                projecttask: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskReadBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-time-entries-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                task_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTimeEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-attachments-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                /** @description The id of the task whose attachments to list. */
                task: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTaskAttachment"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-attachments-upload": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The id of the task to attach the files to. */
                task: number;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    files: string[];
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentUploadResult"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-attachments-download": {
        parameters: {
            query?: {
                /** @description If set and the attachment is an image, return a downscaled PNG preview instead of the original: sm=100px, md=200px, lg=400px, xl=800px. Ignored for non-image attachments. */
                preview_size?: "sm" | "md" | "lg" | "xl";
            };
            header?: never;
            path: {
                /** @description The id of the task the attachment belongs to. */
                task: number;
                /** @description The id of the attachment to download. */
                attachment: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The attachment file bytes. The Content-Type header carries the file's mime type. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-attachments-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The id of the task the attachment belongs to. */
                task: number;
                /** @description The id of the attachment to delete. */
                attachment: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-comments-list": {
        parameters: {
            query?: {
                /** @description Sort order by creation time: 'asc' (oldest first, default) or 'desc' (newest first). */
                order_by?: "asc" | "desc";
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path: {
                task: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTaskComment"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-comments-create": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                task: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskComment"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskComment"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-comments-read": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                task: number;
                commentid: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskCommentReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-comments-update": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                task: number;
                commentid: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskCommentReadBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskComment"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "task-comments-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task: number;
                commentid: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-task-comments-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                task: number;
                commentid: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/TaskCommentReadBody.json
                     */
                    readonly $schema?: string;
                    /** @description The user who wrote the comment. Set from the authenticated user on create; ignored on write. */
                    readonly author?: unknown;
                    /** @description The comment text. May contain HTML; mentions are parsed and notify the mentioned users. */
                    comment?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this comment was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this comment.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this comment's parent task (0=read, 1=read/write, 2=admin). Editing or deleting a comment also requires being its author, so this can over-state what the user may do to the comment.
                     */
                    readonly max_permission?: number;
                    /** @description The reactions on this comment, keyed by reaction value. Managed through the reactions endpoints, not by writing here. */
                    readonly reactions?: {
                        [key: string]: components["schemas"]["User"][] | null;
                    };
                    /**
                     * Format: date-time
                     * @description A timestamp when this comment was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/TaskCommentReadBody.json
                     */
                    readonly $schema?: string;
                    /** @description The user who wrote the comment. Set from the authenticated user on create; ignored on write. */
                    readonly author?: unknown;
                    /** @description The comment text. May contain HTML; mentions are parsed and notify the mentioned users. */
                    comment?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this comment was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this comment.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this comment's parent task (0=read, 1=read/write, 2=admin). Editing or deleting a comment also requires being its author, so this can over-state what the user may do to the comment.
                     */
                    readonly max_permission?: number;
                    /** @description The reactions on this comment, keyed by reaction value. Managed through the reactions endpoints, not by writing here. */
                    readonly reactions?: {
                        [key: string]: components["schemas"]["User"][] | null;
                    };
                    /**
                     * Format: date-time
                     * @description A timestamp when this comment was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskComment"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-position-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric id of the task whose position to set. */
                task: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskPosition"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskPosition"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-relations-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric id of the base task to relate from. */
                task: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskRelation"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskRelation"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tasks-relations-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric id of the base task. */
                task: number;
                /** @description The kind of the relation to remove. */
                relationKind: "subtask" | "parenttask" | "related" | "duplicateof" | "duplicates" | "blocking" | "blocked" | "precedes" | "follows" | "copiedfrom" | "copiedto";
                /** @description The numeric id of the other task in the relation. */
                otherTask: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "teams-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description Also include public teams the user is not a member of. Only honored when public teams are enabled on the instance. */
                include_public?: boolean;
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTeam"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "teams-create": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Team"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Team"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "teams-read": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TeamReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "teams-update": {
        parameters: {
            query?: {
                /** @description How rich-text fields are exchanged. See the API description. */
                format?: "html" | "markdown";
            };
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TeamReadBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Team"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "teams-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-teams-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/TeamReadBody.json
                     */
                    readonly $schema?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this team was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The user who created this team. Set by the server. */
                    readonly created_by?: unknown;
                    description?: string;
                    /** @description The team's external id, set by the openid or ldap provider that created it. Read-only for clients. */
                    readonly external_id?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this team.
                     */
                    readonly id?: number;
                    /** @description Whether the team should be publicly discoverable when sharing a project. Only effective if public teams are enabled on the instance. */
                    is_public?: boolean;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this team (0=read, 2=admin). Teams have no write tier.
                     */
                    readonly max_permission?: number;
                    /** @description All members of this team. Managed through the team members endpoints, not by writing to this field. */
                    readonly members?: unknown[];
                    /** @description The name of this team. */
                    name?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this team was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/TeamReadBody.json
                     */
                    readonly $schema?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this team was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The user who created this team. Set by the server. */
                    readonly created_by?: unknown;
                    description?: string;
                    /** @description The team's external id, set by the openid or ldap provider that created it. Read-only for clients. */
                    readonly external_id?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this team.
                     */
                    readonly id?: number;
                    /** @description Whether the team should be publicly discoverable when sharing a project. Only effective if public teams are enabled on the instance. */
                    is_public?: boolean;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this team (0=read, 2=admin). Teams have no write tier.
                     */
                    readonly max_permission?: number;
                    /** @description All members of this team. Managed through the team members endpoints, not by writing to this field. */
                    readonly members?: unknown[];
                    /** @description The name of this team. */
                    name?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this team was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Team"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "teams-members-add": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                team: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TeamMember"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TeamMember"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "teams-members-remove": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                team: number;
                /** @description The username of the member to remove. */
                user: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "teams-members-toggle-admin": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                team: number;
                /** @description The username of the member whose admin status to toggle. */
                user: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TeamMember"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "time-entries-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description Filter entries with the task filter syntax over user_id, task_id, project_id, start_time and end_time — e.g. "project_id = 5 && start_time > now-7d". Use end_time = null to match running timers. */
                filter?: string;
                /** @description IANA timezone name used to resolve relative dates (now, now-7d) in the filter, e.g. Europe/Berlin. */
                filter_timezone?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedTimeEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "time-entries-create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TimeEntry"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimeEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "time-entries-timer-stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimeEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "time-entries-read": {
        parameters: {
            query?: never;
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimeEntryReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "time-entries-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TimeEntryReadBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimeEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "time-entries-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-time-entries-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/TimeEntryReadBody.json
                     */
                    readonly $schema?: string;
                    /** @description An optional comment describing the logged time. */
                    comment?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this time entry was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /**
                     * Format: date-time
                     * @description When the tracked time ended. Null means a live timer is still running.
                     */
                    end_time?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this time entry.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this time entry (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /**
                     * Format: int64
                     * @description The project this entry is attached to directly. Exactly one of task_id / project_id must be set.
                     */
                    project_id?: number;
                    /**
                     * Format: date-time
                     * @description When the tracked time started.
                     */
                    start_time?: string;
                    /**
                     * Format: int64
                     * @description The task this entry is attached to. Exactly one of task_id / project_id must be set.
                     */
                    task_id?: number;
                    /**
                     * Format: date-time
                     * @description A timestamp when this time entry was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                    /**
                     * Format: int64
                     * @description The id of the user who logged this time entry. Set by the server.
                     */
                    readonly user_id?: number;
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/TimeEntryReadBody.json
                     */
                    readonly $schema?: string;
                    /** @description An optional comment describing the logged time. */
                    comment?: string;
                    /**
                     * Format: date-time
                     * @description A timestamp when this time entry was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /**
                     * Format: date-time
                     * @description When the tracked time ended. Null means a live timer is still running.
                     */
                    end_time?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this time entry.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this time entry (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /**
                     * Format: int64
                     * @description The project this entry is attached to directly. Exactly one of task_id / project_id must be set.
                     */
                    project_id?: number;
                    /**
                     * Format: date-time
                     * @description When the tracked time started.
                     */
                    start_time?: string;
                    /**
                     * Format: int64
                     * @description The task this entry is attached to. Exactly one of task_id / project_id must be set.
                     */
                    task_id?: number;
                    /**
                     * Format: date-time
                     * @description A timestamp when this time entry was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                    /**
                     * Format: int64
                     * @description The id of the user who logged this time entry. Set by the server.
                     */
                    readonly user_id?: number;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimeEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "token-test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenTestBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "token-check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenTestBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tokens-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
                /** @description List tokens of this owner instead of the caller. Must be a bot owned by the authenticated user. */
                owner_id?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedAPIToken"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tokens-create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["APIToken"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["APIToken"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "tokens-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-show": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInfoBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "bots-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedBotUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "bots-create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BotUser"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BotUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "bots-read": {
        parameters: {
            query?: never;
            header?: {
                /** @description Succeeds if the server's resource matches one of the passed values. */
                "If-Match"?: string[] | null;
                /** @description Succeeds if the server's resource matches none of the passed values. On writes, the special value * may be used to match any existing value. */
                "If-None-Match"?: string[] | null;
                /** @description Succeeds if the server's resource date is more recent than the passed date. */
                "If-Modified-Since"?: string;
                /** @description Succeeds if the server's resource date is older or the same as the passed date. */
                "If-Unmodified-Since"?: string;
            };
            path: {
                bot: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BotUserReadBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "bots-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                bot: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BotUserReadBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BotUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "bots-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                bot: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-bots-read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                bot: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/BotUserReadBody.json
                     */
                    readonly $schema?: string;
                    /**
                     * Format: int64
                     * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
                     */
                    readonly bot_owner_id?: number;
                    /**
                     * Format: date-time
                     * @description A timestamp when this user was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The user's email address. Always empty for bot users. */
                    email?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this user.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this bot user (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /** @description The full name of the user. */
                    name?: string;
                    /**
                     * Format: int64
                     * @description The bot's status: 0=active, 2=disabled. Set to 2 to disable the bot, 0 to re-enable it.
                     */
                    status?: number;
                    /**
                     * Format: date-time
                     * @description A timestamp when this user was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                    /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
                    username?: string;
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/BotUserReadBody.json
                     */
                    readonly $schema?: string;
                    /**
                     * Format: int64
                     * @description The id of the owning (human) user. Set by the server on creation; a non-zero value means this user is a bot.
                     */
                    readonly bot_owner_id?: number;
                    /**
                     * Format: date-time
                     * @description A timestamp when this user was created. You cannot change this value.
                     */
                    readonly created?: string;
                    /** @description The user's email address. Always empty for bot users. */
                    email?: string;
                    /**
                     * Format: int64
                     * @description The unique, numeric id of this user.
                     */
                    readonly id?: number;
                    /**
                     * Format: int64
                     * @description The maximum permission the requesting user has on this bot user (0=read, 1=read/write, 2=admin).
                     */
                    readonly max_permission?: number;
                    /** @description The full name of the user. */
                    name?: string;
                    /**
                     * Format: int64
                     * @description The bot's status: 0=active, 2=disabled. Set to 2 to disable the bot, 0 to re-enable it.
                     */
                    status?: number;
                    /**
                     * Format: date-time
                     * @description A timestamp when this user was last updated. You cannot change this value.
                     */
                    readonly updated?: string;
                    /** @description The username of the user. Is always unique. For bot users it must start with the 'bot-' prefix. */
                    username?: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BotUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "auth-confirm-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailConfirm"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-deletion-cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserDeletionPasswordBodyBody"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-deletion-confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserDeletionConfirmBodyBody"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-deletion-request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserDeletionPasswordBodyBody"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-export-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserExportStatus"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-export-download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserExportPasswordBodyBody"];
            };
        };
        responses: {
            /** @description The data export as a zip file. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/zip": string;
                };
            };
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "user-export-request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserExportPasswordBodyBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["User-change-passwordRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserActionMessageBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "auth-password-reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordReset"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "auth-password-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordTokenRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "sessions-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedSession"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "sessions-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The UUID of the session to delete. */
                session: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-avatar-upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The avatar image to upload. Must be a decodable raster image (PNG, JPEG, GIF, TIFF or BMP); it is resized server-side and re-encoded as PNG.
                     */
                    avatar: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-get-avatar-provider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAvatarProviderBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-set-avatar-provider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserAvatarProviderBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAvatarProviderBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "patch-user-get-avatar-provider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json-patch+json": components["schemas"]["JsonPatchOp"][] | null;
                "application/merge-patch+json": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/UserAvatarProviderBody.json
                     */
                    readonly $schema?: string;
                    /** @description The avatar provider. One of: gravatar (uses the user email), upload, initials, marble (random per user), ldap (synced from LDAP), openid (synced from OpenID), default. */
                    avatar_provider?: string;
                };
                "application/merge-patch+shorthand": {
                    /**
                     * Format: uri
                     * @description A URL to the JSON Schema for this object.
                     * @example /api/v2/schemas/UserAvatarProviderBody.json
                     */
                    readonly $schema?: string;
                    /** @description The avatar provider. One of: gravatar (uses the user email), upload, initials, marble (random per user), ldap (synced from LDAP), openid (synced from OpenID), default. */
                    avatar_provider?: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAvatarProviderBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-update-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["User-update-emailRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserActionMessageBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-update-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserGeneralSettings"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserActionMessageBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "caldav-tokens-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedToken"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "caldav-tokens-create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Token"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "caldav-tokens-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The numeric id of the CalDAV token to delete. */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "totp-get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TOTP"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "totp-disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TotpDisableBodyBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "totp-enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TotpEnableBodyBody"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "totp-enroll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TOTP"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "totp-qrcode": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The qr code as a jpeg image. */
            200: {
                headers: {
                    "Content-Type"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-webhooks-list": {
        parameters: {
            query?: {
                /** @description 1-based page number. */
                page?: number;
                /** @description Items per page (max 1000). */
                per_page?: number;
                /** @description Search query; filters the list to items matching this string. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedWebhook"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-webhooks-create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Webhook"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Webhook"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-webhooks-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string[] | null;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-webhooks-update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                webhook: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Webhook"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Webhook"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-webhooks-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                webhook: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "user-timezones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string[] | null;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "token-renew": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RenewTokenBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "auth-refresh-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthTokenBodyBody"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "users-search": {
        parameters: {
            query?: {
                /** @description Search query matched against username, name or full email. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "webhooks-events-list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string[] | null;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "reactions-list": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The kind of entity being reacted to. Either tasks or comments (task comments). */
                entitykind: "tasks" | "comments";
                /** @description The numeric id of the entity being reacted to. */
                entityid: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: components["schemas"]["User"][] | null;
                    };
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "reactions-create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The kind of entity being reacted to. Either tasks or comments (task comments). */
                entitykind: "tasks" | "comments";
                /** @description The numeric id of the entity being reacted to. */
                entityid: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Reaction"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Reaction"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
    "reactions-delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The kind of entity being reacted to. Either tasks or comments (task comments). */
                entitykind: "tasks" | "comments";
                /** @description The numeric id of the entity being reacted to. */
                entityid: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Reaction"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["VikunjaErrorModel"];
                };
            };
        };
    };
}
