/**
 * AUTO-GENERATED — do not edit by hand.
 *
 * Generated from docs/vikunja-openapi.json (Swagger 2.0 -> OpenAPI 3 -> TS)
 * via `npm run generate:api-types`. See docs/API-SPEC.md for the refresh
 * procedure.
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
         * @description Returns per-instance counts (users, projects, shares) plus version and license info. Instance-admin only, gated by the admin_panel feature.
         */
        get: {
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
                        "application/json": components["schemas"]["models.Overview"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
            };
        };
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
         * List projects (admin)
         * @description Paginated list of every project on the instance, regardless of ownership.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Page number, defaults to 1. */
                    page?: number;
                    /** @description Items per page, defaults to the service setting. */
                    per_page?: number;
                    /** @description Search projects by title, description or identifier. */
                    s?: string;
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
                        "application/json": components["schemas"]["models.Project"][];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
            };
        };
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
         * Reassign project owner (admin)
         * @description Reassign a project's owner. The existing update endpoint doesn't allow owner changes — this is the admin-only escape hatch.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description New owner */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["admin.OwnerPatch"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Project"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List users (admin)
         * @description Paginated list of all users on the instance. Supports search by username/email. Exposes fields hidden from the normal user API (is_admin, status).
         */
        get: {
            parameters: {
                query?: {
                    /** @description Search string matched against username and email. */
                    s?: string;
                    /** @description Page number, defaults to 1. */
                    page?: number;
                    /** @description Items per page, defaults to the service setting. */
                    per_page?: number;
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
                        "application/json": components["schemas"]["shared.AdminUser"][];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Create a user (admin)
         * @description Create a new local user account. Respects the admin-only fields `is_admin` and `skip_email_confirm`. The public registration toggle is bypassed.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The user to create */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.CreateUserBody"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["shared.AdminUser"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
            };
        };
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
         * @description Delete a user. With mode=now the user is removed immediately. With mode=scheduled (the default, matching the CLI) the user receives a confirmation email and is scheduled for deletion just like a self-initiated account deletion.
         */
        delete: {
            parameters: {
                query?: {
                    /** @description Deletion mode: 'now' for immediate deletion, 'scheduled' (default) to trigger the email-confirmation self-deletion flow. */
                    mode?: string;
                };
                header?: never;
                path: {
                    /** @description User ID */
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
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
            };
        };
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
         * @description Toggle the instance-admin flag on a user. Demoting the last remaining admin is refused with 400.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description User ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description New admin value */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["admin.IsAdminPatch"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["shared.AdminUser"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
            };
        };
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
         * @description Change a user's status without requiring them to log in.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description User ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description Status */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["admin.StatusPatch"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["shared.AdminUser"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/auth/openid/{provider}/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Authenticate a user with OpenID Connect
         * @description After a redirect from the OpenID Connect provider to the frontend has been made with the authentication `code`, this endpoint can be used to obtain a jwt token for that user and thus log them in.
         */
        post: operations["get-token-openid"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/backgrounds/unsplash/image/{image}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an unsplash image
         * @description Get an unsplash image. **Returns json on error.**
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Unsplash Image ID */
                    image: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The image */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": string;
                    };
                };
                /** @description The image does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/backgrounds/unsplash/image/{image}/thumb": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an unsplash thumbnail image
         * @description Get an unsplash thumbnail image. The thumbnail is cropped to a max width of 200px. **Returns json on error.**
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Unsplash Image ID */
                    image: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The thumbnail */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": string;
                    };
                };
                /** @description The image does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/backgrounds/unsplash/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search for a background from unsplash
         * @description Search for a project background from unsplash
         */
        get: {
            parameters: {
                query?: {
                    /** @description Search backgrounds from unsplash with this search term. */
                    s?: string;
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    p?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description An array with photos */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["background.Image"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        /**
         * Creates a new saved filter
         * @description Creates a new saved filter
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The Saved Filter */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.SavedFilter"];
                    };
                };
                /** @description The user does not have access to that saved filter. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/filters/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Gets one saved filter
         * @description Returns a saved filter by its ID.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Filter ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The Saved Filter */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.SavedFilter"];
                    };
                };
                /** @description The user does not have access to that saved filter. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Updates a saved filter
         * @description Updates a saved filter by its ID.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Filter ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The Saved Filter */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.SavedFilter"];
                    };
                };
                /** @description The user does not have access to that saved filter. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The saved filter does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Removes a saved filter
         * @description Removes a saved filter by its ID.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Filter ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The Saved Filter */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.SavedFilter"];
                    };
                };
                /** @description The user does not have access to that saved filter. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The saved filter does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Info
         * @description Returns the version, frontendurl, motd and various settings of Vikunja
         */
        get: {
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
                        "application/json": components["schemas"]["shared.VikunjaInfos"];
                    };
                };
            };
        };
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
         * Get all labels a user has access to
         * @description Returns all labels which are either created by the user or associated with a task the user has at least read-access to.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search labels by label text. */
                    s?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The labels */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Label"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Create a label
         * @description Creates a new label.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.Label"];
            responses: {
                /** @description The created label object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Label"];
                    };
                };
                /** @description Invalid label object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
         * Gets one label
         * @description Returns one label by its ID.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Label ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The label */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Label"];
                    };
                };
                /** @description The user does not have access to the label */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Label not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Update a label
         * @description Update an existing label. The user needs to be the creator of the label to be able to do this.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Label ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.Label"];
            responses: {
                /** @description The created label object. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Label"];
                    };
                };
                /** @description Invalid label object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Not allowed to update the label. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Label not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        /**
         * Delete a label
         * @description Delete an existing label. The user needs to be the creator of the label to be able to do this.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Label ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The label was successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Label"];
                    };
                };
                /** @description Not allowed to delete the label. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Label not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
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
         * @description Logs a user in. Returns a JWT-Token to authenticate further requests.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The login credentials */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["user.Login"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["auth.Token"];
                    };
                };
                /** @description Invalid user password model. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Invalid username or password. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Invalid totp passcode. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        /**
         * Detect CSV structure
         * @description Analyzes a CSV file and returns auto-detected columns, delimiter, quote character, and date format with suggested column mappings.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /**
                         * Format: binary
                         * @description The CSV file to analyze
                         */
                        import: string;
                    };
                };
            };
            responses: {
                /** @description Detection results with suggested mappings */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["csv.DetectionResult"];
                    };
                };
                /** @description Invalid CSV file */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
        /**
         * Import CSV file
         * @description Imports tasks from a CSV file into Vikunja with the provided configuration.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /**
                         * Format: binary
                         * @description The CSV file to import
                         */
                        import: string;
                        /** @description The import configuration JSON */
                        config: string;
                    };
                };
            };
            responses: {
                /** @description A message telling you everything was migrated successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Invalid CSV file or configuration */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
        /**
         * Preview CSV import
         * @description Generates a preview of the first 5 tasks that would be imported with the given configuration.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /**
                         * Format: binary
                         * @description The CSV file to preview
                         */
                        import: string;
                        /** @description The import configuration JSON */
                        config: string;
                    };
                };
            };
            responses: {
                /** @description Preview of tasks to import */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["csv.PreviewResult"];
                    };
                };
                /** @description Invalid CSV file or configuration */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
         * Get CSV migration status
         * @description Returns if the current user already did the CSV migration or not.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The migration status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["migration.Status"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/microsoft-todo/auth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the auth url from Microsoft Todo
         * @description Returns the auth url where the user needs to get its auth code. This code can then be used to migrate everything from Microsoft Todo to Vikunja.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The auth url. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["handler.AuthURL"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/microsoft-todo/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Migrate all projects, tasks etc. from Microsoft Todo
         * @description Migrates all tasklinsts, tasks, notes and reminders from Microsoft Todo to Vikunja.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The auth token previously obtained from the auth url. See the docs for /migration/microsoft-todo/auth. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["microsofttodo.Migration"];
                };
            };
            responses: {
                /** @description A message telling you everything was migrated successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/microsoft-todo/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get migration status
         * @description Returns if the current user already did the migation or not. This is useful to show a confirmation message in the frontend if the user is trying to do the same migration again.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The migration status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["migration.Status"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        /**
         * Import all projects, tasks etc. from a TickTick backup export
         * @description Imports all projects, tasks, notes, reminders, subtasks and files from a TickTick backup export into Vikunja.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/x-www-form-urlencoded": {
                        /** @description The TickTick backup csv file. */
                        import: string;
                    };
                };
            };
            responses: {
                /** @description A message telling you everything was migrated successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
         * Get migration status
         * @description Returns if the current user already did the migation or not. This is useful to show a confirmation message in the frontend if the user is trying to do the same migration again.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The migration status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["migration.Status"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/todoist/auth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the auth url from todoist
         * @description Returns the auth url where the user needs to get its auth code. This code can then be used to migrate everything from todoist to Vikunja.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The auth url. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["handler.AuthURL"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/todoist/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Migrate all lists, tasks etc. from todoist
         * @description Migrates all projects, tasks, notes, reminders, subtasks and files from todoist to vikunja.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The auth code previously obtained from the auth url. See the docs for /migration/todoist/auth. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["todoist.Migration"];
                };
            };
            responses: {
                /** @description A message telling you everything was migrated successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/todoist/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get migration status
         * @description Returns if the current user already did the migation or not. This is useful to show a confirmation message in the frontend if the user is trying to do the same migration again.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The migration status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["migration.Status"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/trello/auth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the auth url from trello
         * @description Returns the auth url where the user needs to get its auth code. This code can then be used to migrate everything from trello to Vikunja.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The auth url. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["handler.AuthURL"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/trello/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Migrate all projects, tasks etc. from trello
         * @description Migrates all projects, tasks, notes, reminders, subtasks and files from trello to vikunja.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The auth token previously obtained from the auth url. See the docs for /migration/trello/auth. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["trello.Migration"];
                };
            };
            responses: {
                /** @description A message telling you everything was migrated successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migration/trello/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get migration status
         * @description Returns if the current user already did the migation or not. This is useful to show a confirmation message in the frontend if the user is trying to do the same migration again.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The migration status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["migration.Status"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Import all projects, tasks etc. from a Vikunja data export
         * @description Imports all projects, tasks, notes, reminders, subtasks and files from a Vikunjda data export into Vikunja.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/x-www-form-urlencoded": {
                        /** @description The Vikunja export zip file. */
                        import: string;
                    };
                };
            };
            responses: {
                /** @description A message telling you everything was migrated successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get migration status
         * @description Returns if the current user already did the migation or not. This is useful to show a confirmation message in the frontend if the user is trying to do the same migration again.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The migration status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["migration.Status"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        /**
         * Import all projects, tasks etc. from a WeKan board export
         * @description Imports all projects, tasks, labels, checklists, comments, and attachments from a WeKan board JSON export into Vikunja.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/x-www-form-urlencoded": {
                        /** @description The WeKan board JSON export file. */
                        import: string;
                    };
                };
            };
            responses: {
                /** @description A message telling you everything was migrated successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
         * Get migration status
         * @description Returns if the current user already did the migration or not. This is useful to show a confirmation message in the frontend if the user is trying to do the same migration again.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The migration status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["migration.Status"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get all notifications for the current user
         * @description Returns an array with all notifications for the current user.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The notifications */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["notifications.DatabaseNotification"][];
                    };
                };
                /** @description Link shares cannot have notifications. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        /** Mark all notifications of a user as read */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All notifications marked as read. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark a notification as (un-)read
         * @description Marks a notification as either read or unread. A user can only mark their own notifications as read.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Notification ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The notification to mark as read. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.DatabaseNotifications"];
                    };
                };
                /** @description Link shares cannot have notifications. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The notification does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get all projects a user has access to
         * @description Returns all projects a user has access to.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search projects by title. */
                    s?: string;
                    /** @description If true, also returns all archived projects. */
                    is_archived?: boolean;
                    /** @description If set to `permissions`, Vikunja will return the max permission the current user has on this project. You can currently only set this to `permissions`. */
                    expand?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The projects */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Project"][];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Creates a new project
         * @description Creates a new project. If a parent project is provided the user needs to have write access to that project.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The project you want to create. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.Project"];
                };
            };
            responses: {
                /** @description The created project. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Project"];
                    };
                };
                /** @description Invalid project object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
         * Gets one project
         * @description Returns a project by its ID.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The project */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Project"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Updates a project
         * @description Updates a project. This does not include adding a task (see below).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The project with updated values you want to update. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.Project"];
                };
            };
            responses: {
                /** @description The updated project. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Project"];
                    };
                };
                /** @description Invalid project object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Deletes a project
         * @description Delets a project
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The project was successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Invalid project object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/background": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the project background
         * @description Get the project background of a specific project. **Returns json on error.**
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The project background file. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": string;
                    };
                };
                /** @description No access to this project. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
                /** @description The project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /**
         * Remove a project background
         * @description Removes a previously set project background, regardless of the project provider used to set the background. It does not throw an error if the project does not have a background.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The project */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Project"];
                    };
                };
                /** @description No access to this project. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/backgrounds/unsplash": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set an unsplash photo as project background
         * @description Sets a photo from unsplash as project background.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The image you want to set as background */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["background.Image"];
                };
            };
            responses: {
                /** @description The background has been successfully set. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Project"];
                    };
                };
                /** @description Invalid image object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/backgrounds/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Upload a project background
         * @description Upload a project background.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /** @description The file as single file. */
                        background: string;
                    };
                };
            };
            responses: {
                /** @description The background was set successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description File is no image. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description File too large. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/projectusers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get users
         * @description Lists all users (without emailadresses). Also possible to search for a specific user.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Search for a user by its name. */
                    s?: string;
                };
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All (found) users. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["user.User"][];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have the permission to see the project. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Create a task
         * @description Inserts a task into a project.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.Task"];
            responses: {
                /** @description The created task object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Task"];
                    };
                };
                /** @description Invalid task object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/teams": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get teams on a project
         * @description Returns a project with all teams which have access on a given project.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search teams by its name. */
                    s?: string;
                };
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The teams with their permission. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TeamWithPermission"][];
                    };
                };
                /** @description No permission to see the project. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Add a team to a project
         * @description Gives a team access to a project.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The team you want to add to the project. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.TeamProject"];
                };
            };
            responses: {
                /** @description The created team<->project relation. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TeamProject"];
                    };
                };
                /** @description Invalid team project object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The team does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get users on a project
         * @description Returns a project with all users which have access on a given project.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search users by its name. */
                    s?: string;
                };
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The users with the permission they have. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.UserWithPermission"][];
                    };
                };
                /** @description No permission to see the project. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Add a user to a project
         * @description Gives a user access to a project.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The user you want to add to the project. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.ProjectUser"];
                };
            };
            responses: {
                /** @description The created user<->project relation. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.ProjectUser"];
                    };
                };
                /** @description Invalid user project object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/views/{view}/buckets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get all kanban buckets of a project
         * @description Returns all kanban buckets which belong to that project. Buckets are always sorted by their `position` in ascending order. To get all buckets with their tasks, use the tasks endpoint with a kanban view.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                    /** @description Project view ID */
                    view: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The buckets */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Bucket"][];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Create a new bucket
         * @description Creates a new kanban bucket on a project.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project Id */
                    id: number;
                    /** @description Project view ID */
                    view: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.Bucket"];
            responses: {
                /** @description The created bucket object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Bucket"];
                    };
                };
                /** @description Invalid bucket object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/views/{view}/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get tasks in a project
         * @description Returns all tasks for the selected project. When the requested view is a kanban view, a list of buckets containing the tasks will be returned. Otherwise, a list of tasks will be returned.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search tasks by task text. */
                    s?: string;
                    /** @description The sorting parameter. You can pass this multiple times to get the tasks ordered by multiple different parametes, along with `order_by`. Possible values to sort by are `id`, `title`, `description`, `done`, `done_at`, `due_date`, `created_by_id`, `project_id`, `repeat_after`, `priority`, `start_date`, `end_date`, `hex_color`, `percent_done`, `uid`, `created`, `updated`, `relevance`. `relevance` sorts by search relevance (most relevant first, requires `s`; ignored when the database cannot score the query). Default is `id`. */
                    sort_by?: string;
                    /** @description The ordering parameter. Possible values to order by are `asc` or `desc`. Default is `asc`. */
                    order_by?: string;
                    /** @description The filter query to match tasks by. Check out https://vikunja.io/docs/filters for a full explanation of the feature. */
                    filter?: string;
                    /** @description The time zone which should be used for date match (statements like */
                    filter_timezone?: string;
                    /** @description If set to true the result will include filtered fields whose value is set to `null`. Available values are `true` or `false`. Defaults to `false`. */
                    filter_include_nulls?: string;
                    /** @description If set to `subtasks`, Vikunja will fetch only tasks which do not have subtasks and then in a second step, will fetch all of these subtasks. This may result in more tasks than the pagination limit being returned, but all subtasks will be present in the response. If set to `buckets`, the buckets of each task will be present in the response. If set to `reactions`, the reactions of each task will be present in the response. If set to `comments`, the first 50 comments of each task will be present in the response. You can set this multiple times with different values. */
                    expand?: string;
                };
                header?: never;
                path: {
                    /** @description The project ID. */
                    id: number;
                    /** @description The project view ID. */
                    view: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tasks */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Task"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get all api webhook targets for the specified project
         * @description Get all api webhook targets for the specified project.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per bucket per page. This parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                };
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The list of all webhook targets */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Webhook"][];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Create a webhook target
         * @description Create a webhook target which receives POST requests about specified events from a project.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The webhook target object with required fields */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.Webhook"];
                };
            };
            responses: {
                /** @description The created webhook target. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Webhook"];
                    };
                };
                /** @description Invalid webhook object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{id}/webhooks/{webhookID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change a webhook target's events.
         * @description Change a webhook target's events. You cannot change other values of a webhook.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                    /** @description Webhook ID */
                    webhookID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Updated webhook target */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Webhook"];
                    };
                };
                /** @description The webhok target does not exist */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Deletes an existing webhook target
         * @description Delete any of the project's webhook targets.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    id: number;
                    /** @description Webhook ID */
                    webhookID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The webhok target does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectID}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Duplicate an existing project
         * @description Copies the project, tasks, files, kanban data, assignees, comments, attachments, labels, relations and backgrounds from one project to a new one. User/team permissions and link shares are only copied when duplicate_shares is set to true. The user needs read access in the project and write access in the parent of the new project.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description The project ID to duplicate */
                    projectID: number;
                };
                cookie?: never;
            };
            /** @description The target parent project which should hold the copied project. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.ProjectDuplicate"];
                };
            };
            responses: {
                /** @description The created project. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.ProjectDuplicate"];
                    };
                };
                /** @description Invalid project duplicate object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project or its parent. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectID}/teams/{teamID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Update a team <-> project relation
         * @description Update a team <-> project relation. Mostly used to update the permission that team has.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    projectID: number;
                    /** @description Team ID */
                    teamID: number;
                };
                cookie?: never;
            };
            /** @description The team you want to update. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.TeamProject"];
                };
            };
            responses: {
                /** @description The updated team <-> project relation. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TeamProject"];
                    };
                };
                /** @description The user does not have admin-access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Team or project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Delete a team from a project
         * @description Delets a team from a project. The team won't have access to the project anymore.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    projectID: number;
                    /** @description Team ID */
                    teamID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The team was successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Team or project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectID}/users/{userID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Update a user <-> project relation
         * @description Update a user <-> project relation. Mostly used to update the permission that user has.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    projectID: number;
                    /** @description User ID */
                    userID: number;
                };
                cookie?: never;
            };
            /** @description The user you want to update. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.ProjectUser"];
                };
            };
            responses: {
                /** @description The updated user <-> project relation. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.ProjectUser"];
                    };
                };
                /** @description The user does not have admin-access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User or project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Delete a user from a project
         * @description Delets a user from a project. The user won't have access to the project anymore.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    projectID: number;
                    /** @description User ID */
                    userID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The user was successfully removed from the project. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description user or project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectID}/views/{view}/buckets/{bucketID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Update an existing bucket
         * @description Updates an existing kanban bucket.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project Id */
                    projectID: number;
                    /** @description Bucket Id */
                    bucketID: number;
                    /** @description Project view ID */
                    view: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.Bucket"];
            responses: {
                /** @description The created bucket object. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Bucket"];
                    };
                };
                /** @description Invalid bucket object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The bucket does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Deletes an existing bucket
         * @description Deletes an existing kanban bucket and dissociates all of its task. It does not delete any tasks. You cannot delete the last bucket on a project.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project Id */
                    projectID: number;
                    /** @description Bucket Id */
                    bucketID: number;
                    /** @description Project view ID */
                    view: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The bucket does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get all link shares for a project
         * @description Returns all link shares which exist for a given project
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search shares by hash. */
                    s?: string;
                };
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The share links */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.LinkSharing"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Share a project via link
         * @description Share a project via link. The user needs to have write-access to the project to be able do this.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                };
                cookie?: never;
            };
            /** @description The new link share object */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.LinkSharing"];
                };
            };
            responses: {
                /** @description The created link share object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.LinkSharing"];
                    };
                };
                /** @description Invalid link share object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Not allowed to add the project share. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The project does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
         * Get one link shares for a project
         * @description Returns one link share by its ID.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                    /** @description Share ID */
                    share: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The share links */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.LinkSharing"];
                    };
                };
                /** @description No access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Share Link not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /**
         * Remove a link share
         * @description Remove a link share. The user needs to have write-access to the project to be able do this.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                    /** @description Share Link ID */
                    share: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The link was successfully removed. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Not allowed to remove the link. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Share Link not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get one task by its per-project index
         * @description Returns a single task identified by its per-project index. Useful when resolving human-readable references like "PROJ-42" to a canonical task object. The `project` path parameter accepts either a numeric project id or the project's identifier (e.g. "PROJ"); values consisting solely of digits are always interpreted as ids. Note that task indexes are reassigned when a task is moved between projects, so long-lived references should use the returned task id instead.
         */
        get: {
            parameters: {
                query?: {
                    /** @description If set to `subtasks`, Vikunja will fetch only tasks which do not have subtasks and then in a second step, will fetch all of these subtasks. This may result in more tasks than the pagination limit being returned, but all subtasks will be present in the response. You can only set this to `subtasks`. */
                    expand?: string;
                };
                header?: never;
                path: {
                    /** @description The project id or the project's identifier */
                    project: string;
                    /** @description The task's per-project index */
                    index: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The task */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Task"];
                    };
                };
                /** @description Invalid project ID or index */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the task */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Task not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
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
         * Get all project views for a project
         * @description Returns all project views for a sepcific project
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The project views */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.ProjectView"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Create a project view
         * @description Create a project view in a specific project.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                };
                cookie?: never;
            };
            /** @description The project view you want to create. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.ProjectView"];
                };
            };
            responses: {
                /** @description The created project view */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.ProjectView"];
                    };
                };
                /** @description The user does not have access to create a project view */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project}/views/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one project view
         * @description Returns a project view by its ID.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                    /** @description Project View ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The project view */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.ProjectView"];
                    };
                };
                /** @description The user does not have access to this project view */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Updates a project view
         * @description Updates a project view.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                    /** @description Project View ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The project view with updated values you want to change. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.ProjectView"];
                };
            };
            responses: {
                /** @description The updated project view. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.ProjectView"];
                    };
                };
                /** @description Invalid project view object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Delete a project view
         * @description Deletes a project view.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                    /** @description Project View ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The project view was successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The user does not have access to the project view */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        put?: never;
        /**
         * Update a task bucket
         * @description Updates a task in a bucket
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Project ID */
                    project: number;
                    /** @description Project View ID */
                    view: number;
                    /** @description Bucket ID */
                    bucket: number;
                };
                cookie?: never;
            };
            /** @description The id of the task you want to move into the bucket. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.TaskBucket"];
                };
            };
            responses: {
                /** @description The updated task bucket. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskBucket"];
                    };
                };
                /** @description Invalid task bucket object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register
         * @description Creates a new user account.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The user with credentials to create */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.UserRegister"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["user.User"];
                    };
                };
                /** @description No or invalid user register object provided / User already exists. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
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
         * Get a list of all token api routes
         * @description Returns a list of all API routes which are available to use with an api token, not a user login.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The list of all routes. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.APITokenRoute"][];
                    };
                };
            };
        };
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
         * Get an auth token for a share
         * @description Get a jwt auth token for a shared project from a share hash.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description The share hash */
                    share: string;
                };
                cookie?: never;
            };
            /** @description The password for link shares which require one. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.LinkShareAuth"];
                };
            };
            responses: {
                /** @description The valid jwt auth token. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["auth.Token"];
                    };
                };
                /** @description Invalid link share object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        /**
         * Subscribes the current user to an entity.
         * @description Subscribes the current user to an entity.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description The entity the user subscribes to. Can be either `project` or `task`. */
                    entity: string;
                    /** @description The numeric id of the entity to subscribe to. */
                    entityID: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The subscription */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Subscription"];
                    };
                };
                /** @description The user does not have access to subscribe to this entity. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The subscription entity is invalid. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        /**
         * Unsubscribe the current user from an entity.
         * @description Unsubscribes the current user to an entity.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description The entity the user subscribed to. Can be either `project` or `task`. */
                    entity: string;
                    /** @description The numeric id of the subscribed entity to. */
                    entityID: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The subscription */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Subscription"];
                    };
                };
                /** @description The user does not have access to subscribe to this entity. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The subscription does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get tasks
         * @description Returns all tasks on any project the user has access to.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search tasks by task text. */
                    s?: string;
                    /** @description The sorting parameter. You can pass this multiple times to get the tasks ordered by multiple different parametes, along with `order_by`. Possible values to sort by are `id`, `title`, `description`, `done`, `done_at`, `due_date`, `created_by_id`, `project_id`, `repeat_after`, `priority`, `start_date`, `end_date`, `hex_color`, `percent_done`, `uid`, `created`, `updated`, `relevance`. `relevance` sorts by search relevance (most relevant first, requires `s`; ignored when the database cannot score the query). Default is `id`. */
                    sort_by?: string;
                    /** @description The ordering parameter. Possible values to order by are `asc` or `desc`. Default is `asc`. */
                    order_by?: string;
                    /** @description The filter query to match tasks by. Check out https://vikunja.io/docs/filters for a full explanation of the feature. */
                    filter?: string;
                    /** @description The time zone which should be used for date match (statements like */
                    filter_timezone?: string;
                    /** @description If set to true the result will include filtered fields whose value is set to `null`. Available values are `true` or `false`. Defaults to `false`. */
                    filter_include_nulls?: string;
                    /** @description If set to `subtasks`, Vikunja will fetch only tasks which do not have subtasks and then in a second step, will fetch all of these subtasks. This may result in more tasks than the pagination limit being returned, but all subtasks will be present in the response. If set to `buckets`, the buckets of each task will be present in the response. If set to `reactions`, the reactions of each task will be present in the response. If set to `comments`, the first 50 comments of each task will be present in the response. You can set this multiple times with different values. */
                    expand?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tasks */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Task"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        put?: never;
        /**
         * Update multiple tasks
         * @description Updates multiple tasks atomically. All provided tasks must be writable by the user.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description Bulk task update payload */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.BulkTask"];
                };
            };
            responses: {
                /** @description Updated tasks */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Task"][];
                    };
                };
                /** @description Invalid request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the tasks */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one task
         * @description Returns one task by its ID
         */
        get: {
            parameters: {
                query?: {
                    /** @description If set to `subtasks`, Vikunja will fetch only tasks which do not have subtasks and then in a second step, will fetch all of these subtasks. This may result in more tasks than the pagination limit being returned, but all subtasks will be present in the response. If set to `buckets`, the buckets of each task will be present in the response. If set to `reactions`, the reactions of each task will be present in the response. If set to `comments`, the first 50 comments of each task will be present in the response. You can set this multiple times with different values. */
                    expand?: string;
                };
                header?: never;
                path: {
                    /** @description The task ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The task */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Task"];
                    };
                };
                /** @description Task not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Update a task
         * @description Updates a task. This includes marking it as done. Assignees you pass will be updated, see their individual endpoints for more details on how this is done. To update labels, see the description of the endpoint.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description The Task ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.Task"];
            responses: {
                /** @description The updated task object. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Task"];
                    };
                };
                /** @description Invalid task object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the task (aka its project) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Delete a task
         * @description Deletes a task from a project. This does not mean "mark it done".
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The created task object. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Invalid task ID provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the project */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get  all attachments for one task.
         * @description Get all task attachments for one task.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                };
                header?: never;
                path: {
                    /** @description Task ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All attachments for this task */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskAttachment"][];
                    };
                };
                /** @description No access to this task. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The task does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Upload a task attachment
         * @description Upload a task attachment. You can pass multiple files with the files form param.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /** @description The file, as multipart form file. You can pass multiple. */
                        files: string;
                    };
                };
            };
            responses: {
                /** @description Attachments were uploaded successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description No access to the task. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The task does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/attachments/{attachmentID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one attachment.
         * @description Get one attachment for download. **Returns json on error.**
         */
        get: {
            parameters: {
                query?: {
                    /** @description The size of the preview image. Can be sm = 100px, md = 200px, lg = 400px or xl = 800px. If provided, a preview image will be returned if the attachment is an image. */
                    preview_size?: string;
                };
                header?: never;
                path: {
                    /** @description Task ID */
                    id: number;
                    /** @description Attachment ID */
                    attachmentID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The attachment file. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": string;
                    };
                };
                /** @description No access to this task. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
                /** @description The task does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /**
         * Delete an attachment
         * @description Delete an attachment.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    id: number;
                    /** @description Attachment ID */
                    attachmentID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The attachment was deleted successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description No access to this task. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The task does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/position": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Updates a task position
         * @description Updates a task position.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The task position with updated values you want to change. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.TaskPosition"];
                };
            };
            responses: {
                /** @description The updated task position. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskPosition"];
                    };
                };
                /** @description Invalid task position object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
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
        put?: never;
        /**
         * Mark a task as read
         * @description Marks a task as read for the current user by removing the unread status entry.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    projecttask: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The task unread status object. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskUnreadStatus"];
                    };
                };
                /** @description The user does not have access to the task */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/assignees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get all assignees for a task
         * @description Returns an array with all assignees for this task.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search assignees by their username. */
                    s?: string;
                };
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The assignees */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["user.User"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Add a new assignee to a task
         * @description Adds a new assignee to a task. The assignee needs to have access to the project, the doer must be able to edit this task.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                };
                cookie?: never;
            };
            /** @description The assingee object */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.TaskAssginee"];
                };
            };
            responses: {
                /** @description The created assingee object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskAssginee"];
                    };
                };
                /** @description Invalid assignee object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/assignees/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add multiple new assignees to a task
         * @description Adds multiple new assignees to a task. The assignee needs to have access to the project, the doer must be able to edit this task. Every user not in the project will be unassigned from the task, pass an empty array to unassign everyone.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                };
                cookie?: never;
            };
            /** @description The array of assignees */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.BulkAssignees"];
                };
            };
            responses: {
                /** @description The created assingees object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskAssginee"];
                    };
                };
                /** @description Invalid assignee object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/assignees/{userID}": {
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
         * Delete an assignee
         * @description Un-assign a user from a task.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                    /** @description Assignee user ID */
                    userID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The assignee was successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Not allowed to delete the assignee. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get all task comments
         * @description Get all task comments. The user doing this need to have at least read access to the task.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Sort order. Can be 'asc' for ascending or 'desc' for descending. Defaults to 'asc'. */
                    order_by?: string;
                };
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The array with all task comments */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskComment"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Create a new task comment
         * @description Create a new task comment. The user doing this need to have at least write access to the task this comment should belong to.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                };
                cookie?: never;
            };
            /** @description The task comment object */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.TaskComment"];
                };
            };
            responses: {
                /** @description The created task comment object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskComment"];
                    };
                };
                /** @description Invalid task comment object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/comments/{commentID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a task comment
         * @description Get a task comment. The user doing this need to have at least read access to the task this comment belongs to.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                    /** @description Comment ID */
                    commentID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The task comment object. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskComment"];
                    };
                };
                /** @description Invalid task comment object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The task comment was not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Update an existing task comment
         * @description Update an existing task comment. The user doing this need to have at least write access to the task this comment belongs to.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                    /** @description Comment ID */
                    commentID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The updated task comment object. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskComment"];
                    };
                };
                /** @description Invalid task comment object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The task comment was not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Remove a task comment
         * @description Remove a task comment. The user doing this need to have at least write access to the task this comment belongs to.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                    /** @description Comment ID */
                    commentID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The task comment was successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Invalid task comment object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The task comment was not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Duplicate a task
         * @description Copies a task with all its properties (labels, assignees, attachments, reminders) into the same project. Creates a "copied from" relation between the new and original task.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description The task ID to duplicate */
                    taskID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The duplicated task. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskDuplicate"];
                    };
                };
                /** @description The user does not have access to the task. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/labels/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Update all labels on a task.
         * @description Updates all labels on a task. Every label which is not passed but exists on the task will be deleted. Every label which does not exist on the task will be added. All labels which are passed and already exist on the task won't be touched.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                };
                cookie?: never;
            };
            /** @description The array of labels */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.LabelTaskBulk"];
                };
            };
            responses: {
                /** @description The updated labels object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.LabelTaskBulk"];
                    };
                };
                /** @description Invalid label object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/relations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Create a new relation between two tasks
         * @description Creates a new relation between two tasks. The user needs to have update permissions on the base task and at least read permissions on the other task. Both tasks do not need to be on the same project. Take a look at the docs for available task relation kinds.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.TaskRelation"];
            responses: {
                /** @description The created task relation object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TaskRelation"];
                    };
                };
                /** @description Invalid task relation object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskID}/relations/{relationKind}/{otherTaskID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a task relation */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    taskID: number;
                    /** @description The kind of the relation. See the TaskRelation type for more info. */
                    relationKind: string;
                    /** @description The id of the other task. */
                    otherTaskID: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.TaskRelation"];
            responses: {
                /** @description The task relation was successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Invalid task relation object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The task relation was not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task}/labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get all labels on a task
         * @description Returns all labels which are assicociated with a given task.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search labels by label text. */
                    s?: string;
                };
                header?: never;
                path: {
                    /** @description Task ID */
                    task: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The labels */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Label"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Add a label to a task
         * @description Add a label to a task. The user needs to have write-access to the project to be able do this.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    task: number;
                };
                cookie?: never;
            };
            /** @description The label object */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.LabelTask"];
                };
            };
            responses: {
                /** @description The created label relation object. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.LabelTask"];
                    };
                };
                /** @description Invalid label object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Not allowed to add the label. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The label does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{task}/labels/{label}": {
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
         * @description Remove a label from a task. The user needs to have write-access to the project to be able do this.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Task ID */
                    task: number;
                    /** @description Label ID */
                    label: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The label was successfully removed. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Not allowed to remove the label. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Label not found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get teams
         * @description Returns all teams the current user is part of.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number. Used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of items per page. Note this parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search teams by its name. */
                    s?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The teams. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Team"][];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Creates a new team
         * @description Creates a new team.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The team you want to create. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.Team"];
                };
            };
            responses: {
                /** @description The created team. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Team"];
                    };
                };
                /** @description Invalid team object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
         * Gets one team
         * @description Returns a team by its ID.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Team ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The team */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Team"];
                    };
                };
                /** @description The user does not have access to the team */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Updates a team
         * @description Updates a team.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Team ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The team with updated values you want to update. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.Team"];
                };
            };
            responses: {
                /** @description The updated team. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Team"];
                    };
                };
                /** @description Invalid team object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Deletes a team
         * @description Delets a team. This will also remove the access for all users in that team.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Team ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The team was successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Invalid team object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Add a user to a team
         * @description Add a user to a team.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Team ID */
                    id: number;
                };
                cookie?: never;
            };
            /** @description The user to be added to a team. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.TeamMember"];
                };
            };
            responses: {
                /** @description The newly created member object */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.TeamMember"];
                    };
                };
                /** @description Invalid member object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description The user does not have access to the team */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams/{id}/members/{userID}/admin": {
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
         * @description If a user is team admin, this will make them member and vise-versa.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Team ID */
                    id: number;
                    /** @description User ID */
                    userID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The member permission was successfully changed. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams/{id}/members/{username}": {
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
         * Remove a user from a team
         * @description Remove a user from a team. This will also revoke any access this user might have via that team. A user can remove themselves from the team if they are not the last user in the team.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description The ID of the team you want to remove th user from */
                    id: number;
                    /** @description The username of the user you want to remove */
                    username: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The user was successfully removed from the team. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/test/all": {
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
         * Truncate all tables
         * @description Removes all data from every Vikunja table. Used by e2e tests to ensure clean state before each test. Requires the testing token.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All tables truncated. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: string;
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/test/{table}": {
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
         * Reset the db to a defined state
         * @description Fills the specified table with the content provided in the payload. You need to enable the testing endpoint before doing this and provide the `Authorization: <token>` secret when making requests to this endpoint. See docs for more details.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description The table to reset */
                    table: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Everything has been imported successfully. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["user.User"][];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get all api tokens of the current user
         * @description Returns all api tokens the current user has created.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The page number, used for pagination. If not provided, the first page of results is returned. */
                    page?: number;
                    /** @description The maximum number of tokens per page. This parameter is limited by the configured maximum of items per page. */
                    per_page?: number;
                    /** @description Search tokens by their title. */
                    s?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The list of all tokens */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.APIToken"][];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Create a new api token
         * @description Create a new api token to use on behalf of the user creating it.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The token object with required fields */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.APIToken"];
                };
            };
            responses: {
                /** @description The created token. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.APIToken"];
                    };
                };
                /** @description Invalid token object provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tokens/{tokenID}": {
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
         * Deletes an existing api token
         * @description Delete any of the user's api tokens.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Token ID */
                    tokenID: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successfully deleted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The token does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get user information
         * @description Returns the current user object with their settings.
         */
        get: {
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
                        "application/json": components["schemas"]["v1.UserWithSettings"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
         * Confirm the email of a new user
         * @description Confirms the email of a newly registered user.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The token. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["user.EmailConfirm"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Bad token provided. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Abort a user deletion request
         * @description Aborts an in-progress user deletion.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The user password to confirm. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.UserPasswordConfirmation"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Bad password provided. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Confirm a user deletion request
         * @description Confirms the deletion request of a user sent via email.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The token. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.UserDeletionRequestConfirm"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Bad token provided. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Request the deletion of the user
         * @description Requests the deletion of the current user. It will trigger an email which has to be confirmed to start the deletion.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The user password. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.UserPasswordConfirmation"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Bad password provided. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        /** Get current user data export */
        get: {
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
                        "application/json": components["schemas"]["models.UserExportStatus"];
                    };
                };
            };
        };
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
        /** Download a user data export. */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description User password to confirm the download. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.UserPasswordConfirmation"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description No user data export found. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        /** Request a user data export. */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description User password to confirm the data export request. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.UserPasswordConfirmation"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/logout": {
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
         * @description Destroys the current session and clears the refresh token cookie. For OpenID Connect sessions the response includes an `oidc_logout_url` the client should redirect to so the provider session is ended too.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successfully logged out. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["v1.LogoutResponse"];
                    };
                };
            };
        };
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
         * Change password
         * @description Lets the current user change its password.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The current and new password. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.UserPassword"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Resets a password
         * @description Resets a user email with a previously reset token.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The token with the new password. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["user.PasswordReset"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Bad token provided. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Request password reset token
         * @description Requests a token to reset a users password. The token is sent via email.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The username of the user to request a token for. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["user.PasswordTokenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The user does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
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
        /**
         * Return user avatar setting
         * @description Returns the current user's avatar setting.
         */
        get: {
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
                        "application/json": components["schemas"]["v1.UserAvatarProvider"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Set the user's avatar
         * @description Changes the user avatar. Valid types are gravatar (uses the user email), upload, initials, marble, ldap (synced from LDAP server), openid (synced from OpenID provider), default.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The user's avatar setting */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["v1.UserAvatarProvider"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/avatar/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Upload a user avatar
         * @description Upload a user avatar. This will also set the user's avatar provider to "upload"
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /** @description The avatar as single file. */
                        avatar: string;
                    };
                };
            };
            responses: {
                /** @description The avatar was set successfully. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description File is no image. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description File too large. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
        put?: never;
        /**
         * Update email address
         * @description Lets the current user change their email address.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The new email address and current password. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["user.EmailUpdate"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
        put?: never;
        /** Change general user settings of the current user. */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The updated user settings */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.UserGeneralSettings"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Returns the caldav tokens for the current user
         * @description Return the IDs and created dates of all caldav tokens for the current user.
         */
        get: {
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
                        "application/json": components["schemas"]["user.Token"][];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Generate a caldav token
         * @description Generates a caldav token which can be used for the caldav api. It is not possible to see the token again after it was generated.
         */
        put: {
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
                        "application/json": components["schemas"]["user.Token"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
        /** Delete a caldav token by id */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Token ID */
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
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Totp setting for the current user
         * @description Returns the current user totp setting or an error if it is not enabled.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The totp settings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["user.TOTP"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Disable totp settings
         * @description Disables any totp settings for the current user.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The current user's password (only password is enough). */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["user.Login"];
                };
            };
            responses: {
                /** @description Successfully disabled */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Enable a previously enrolled totp setting.
         * @description Enables a previously enrolled totp setting by providing a totp passcode.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The totp passcode. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["user.TOTPPasscode"];
                };
            };
            responses: {
                /** @description Successfully enabled */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description TOTP is not enrolled. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Enroll a user into totp
         * @description Creates an initial setup for the user in the db. After this step, the user needs to verify they have a working totp setup with the "enable totp" endpoint.
         */
        post: {
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
                        "application/json": components["schemas"]["user.TOTP"];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description User does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Totp QR Code
         * @description Returns a qr code for easier setup at end user's devices.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The qr code as jpeg image */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string;
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get all user-level webhook targets
         * @description Get all webhook targets configured for the current user (not project-specific).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The list of webhook targets */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Webhook"][];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Create a user-level webhook target
         * @description Create a webhook target for the current user that receives events across all projects.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description The webhook target */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["models.Webhook"];
                };
            };
            responses: {
                /** @description The created webhook target */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Webhook"];
                    };
                };
                /** @description Invalid webhook */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
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
         * Get available user-directed webhook events
         * @description Get all webhook events that can be used with user-level webhook targets.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The list of user-directed webhook events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/settings/webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Update a user-level webhook target
         * @description Update the events for a user-level webhook target.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Webhook ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The updated webhook target */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Webhook"];
                    };
                };
                /** @description Webhook not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Delete a user-level webhook target
         * @description Delete a user-level webhook target.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Webhook ID */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successfully deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description Webhook not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get all available time zones on this vikunja instance
         * @description Because available time zones depend on the system Vikunja is running on, this endpoint returns a project of all valid time zones this particular Vikunja instance can handle. The project of time zones is not sorted, you should sort it on the client.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All available time zones. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string[];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Renew link share token
         * @description Returns a new valid jwt link share token. Only works for link share tokens.
         */
        post: {
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
                        "application/json": components["schemas"]["auth.Token"];
                    };
                };
                /** @description Only link share tokens can be renewed. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * @description Exchanges the refresh token cookie for a new short-lived JWT.
         */
        post: {
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
                        "application/json": components["schemas"]["auth.Token"];
                    };
                };
                /** @description Invalid or expired refresh token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get users
         * @description Search for a user by its username, name or full email. Name (not username) or email require that the user has enabled this in their settings, unless both users share an external team (synced via OIDC/LDAP), in which case they can always find each other.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The search criteria. */
                    s?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All (found) users. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["user.User"][];
                    };
                };
                /** @description Something's invalid. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal server error. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
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
         * Get all possible webhook events
         * @description Get all possible webhook events to use when creating or updating a webhook target.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The list of all possible webhook events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": string[];
                    };
                };
                /** @description Internal server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/{kind}/{id}/reactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get all reactions for an entity
         * @description Returns all reactions for an entity
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Entity ID */
                    id: number;
                    /** @description The kind of the entity. Can be either `tasks` or `comments` for task comments */
                    kind: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The reactions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.ReactionMap"][];
                    };
                };
                /** @description The user does not have access to the entity */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        /**
         * Add a reaction to an entity
         * @description Add a reaction to an entity. Will do nothing if the reaction already exists.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Entity ID */
                    id: number;
                    /** @description The kind of the entity. Can be either `tasks` or `comments` for task comments */
                    kind: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.Reaction"];
            responses: {
                /** @description The created reaction */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Reaction"];
                    };
                };
                /** @description The user does not have access to the entity */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/{kind}/{id}/reactions/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Removes the user's reaction
         * @description Removes the reaction of that user on that entity.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Entity ID */
                    id: number;
                    /** @description The kind of the entity. Can be either `tasks` or `comments` for task comments */
                    kind: number;
                };
                cookie?: never;
            };
            requestBody: components["requestBodies"]["models.Reaction"];
            responses: {
                /** @description The reaction was successfully removed. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
                /** @description The user does not have access to the entity */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["web.HTTPError"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/{username}/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * User Avatar
         * @description Returns the user avatar as image.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The size of the avatar you want to get. If bigger than the max configured size this will be adjusted to the maximum size. */
                    size?: number;
                };
                header?: never;
                path: {
                    /** @description The username of the user who's avatar you want to get */
                    username: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The avatar */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": string;
                    };
                };
                /** @description The user does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
                /** @description Internal error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": components["schemas"]["models.Message"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
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
        "admin.IsAdminPatch": {
            /** @description Pointer to distinguish "omitted" from false; an empty body would silently demote otherwise. */
            is_admin?: boolean;
        };
        "admin.OwnerPatch": {
            owner_id?: number;
        };
        "admin.StatusPatch": {
            /** @description Pointer to distinguish "omitted" from StatusActive; an empty body would silently re-enable otherwise. */
            status?: components["schemas"]["user.Status"];
        };
        "auth.Token": {
            /** @example eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c */
            token?: string;
        };
        "background.Image": {
            blur_hash?: string;
            id?: string;
            /** @description This can be used to supply extra information from an image provider to clients */
            info?: unknown;
            thumb?: string;
            url?: string;
        };
        "code_vikunja_io_api_pkg_modules_auth_openid.Provider": {
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
        "csv.ColumnMapping": {
            attribute?: components["schemas"]["csv.TaskAttribute"];
            column_index?: number;
            column_name?: string;
        };
        "csv.DetectionResult": {
            columns?: string[];
            date_format?: string;
            delimiter?: string;
            preview_rows?: string[][];
            quote_char?: string;
            suggested_mapping?: components["schemas"]["csv.ColumnMapping"][];
        };
        "csv.PreviewResult": {
            tasks?: components["schemas"]["csv.PreviewTask"][];
            total_rows?: number;
        };
        "csv.PreviewTask": {
            description?: string;
            done?: boolean;
            due_date?: string;
            end_date?: string;
            labels?: string[];
            priority?: number;
            project?: string;
            start_date?: string;
            title?: string;
        };
        /** @enum {string} */
        "csv.TaskAttribute": "title" | "description" | "due_date" | "start_date" | "end_date" | "done" | "priority" | "labels" | "project" | "reminder" | "ignore";
        "files.File": {
            created?: string;
            id?: number;
            mime?: string;
            name?: string;
            size?: number;
        };
        "handler.AuthURL": {
            url?: string;
        };
        /** @enum {integer} */
        "license.Feature": 0 | 1 | 2 | 3;
        "license.Info": {
            expires_at?: string;
            features?: string[];
            instance_id?: string;
            last_check_failed?: boolean;
            licensed?: boolean;
            max_users?: number;
            validated_at?: string;
        };
        "microsofttodo.Migration": {
            code?: string;
        };
        "migration.Status": {
            finished_at?: string;
            id?: number;
            migrator_name?: string;
            started_at?: string;
        };
        "models.APIPermissions": {
            [key: string]: string[];
        };
        "models.APIToken": {
            /** @description A timestamp when this api key was created. You cannot change this value. */
            created?: string;
            /** @description The date when this key expires. */
            expires_at?: string;
            /** @description The unique, numeric id of this api key. */
            id?: number;
            /**
             * @description The user ID of the token owner. When creating a token for a bot user, set this
             *     to the bot's ID. If omitted, defaults to the authenticated user.
             */
            owner_id?: number;
            /** @description The permissions this token has. Possible values are available via the /routes endpoint and consist of the keys of the list from that endpoint. For example, if the token should be able to read all tasks as well as update existing tasks, you should add `{"tasks":["read_all","update"]}`. */
            permissions?: components["schemas"]["models.APIPermissions"];
            /** @description A human-readable name for this token */
            title?: string;
            /** @description The actual api key. Only visible after creation. */
            token?: string;
        };
        "models.APITokenRoute": {
            [key: string]: components["schemas"]["models.RouteDetail"];
        };
        "models.Bucket": {
            /** @description The number of tasks currently in this bucket */
            count?: number;
            /** @description A timestamp when this bucket was created. You cannot change this value. */
            created?: string;
            /** @description The user who initially created the bucket. */
            created_by?: components["schemas"]["user.User"];
            /** @description The unique, numeric id of this bucket. */
            id?: number;
            /** @description How many tasks can be at the same time on this board max */
            limit?: number;
            /** @description The position this bucket has when querying all buckets. See the tasks.position property on how to use this. */
            position?: number;
            /** @description The project view this bucket belongs to. */
            project_view_id?: number;
            /** @description All tasks which belong to this bucket. */
            tasks?: components["schemas"]["models.Task"][];
            /** @description The title of this bucket. */
            title?: string;
            /** @description A timestamp when this bucket was last updated. You cannot change this value. */
            updated?: string;
        };
        "models.BulkAssignees": {
            /** @description A project with all assignees */
            assignees?: components["schemas"]["user.User"][];
        };
        "models.BulkTask": {
            fields?: string[];
            task_ids?: number[];
            tasks?: components["schemas"]["models.Task"][];
            values?: components["schemas"]["models.Task"];
        };
        "models.CreateUserBody": {
            /** @description The user's email address */
            email?: string;
            /** @description Mark the new user as an instance admin. */
            is_admin?: boolean;
            /** @description The language of the new user. Must be a valid IETF BCP 47 language code and exist in Vikunja. */
            language?: string;
            /** @description The full name of the new user. Optional. */
            name?: string;
            /** @description The user's password in clear text. Only used when registering the user. The maximum limi is 72 bytes, which may be less than 72 characters. This is due to the limit in the bcrypt hashing algorithm used to store passwords in Vikunja. */
            password?: string;
            /** @description Activate the new user immediately without email confirmation. */
            skip_email_confirm?: boolean;
            /** @description The user's username. Cannot contain anything that looks like an url or whitespaces. */
            username?: string;
        };
        "models.DatabaseNotifications": {
            /** @description A timestamp when this notification was created. You cannot change this value. */
            created?: string;
            /** @description The unique, numeric id of this notification. */
            id?: number;
            /** @description The name of the notification */
            name?: string;
            /** @description The actual content of the notification. */
            notification?: unknown;
            /**
             * @description Whether or not to mark this notification as read or unread.
             *     True is read, false is unread.
             */
            read?: boolean;
            /** @description When this notification is marked as read, this will be updated with the current timestamp. */
            read_at?: string;
        };
        "models.Label": {
            /** @description A timestamp when this label was created. You cannot change this value. */
            created?: string;
            /** @description The user who created this label */
            created_by?: components["schemas"]["user.User"];
            /** @description The label description. */
            description?: string;
            /** @description The color this label has in hex format. */
            hex_color?: string;
            /** @description The unique, numeric id of this label. */
            id?: number;
            /** @description The title of the label. You'll see this one on tasks associated with it. */
            title?: string;
            /** @description A timestamp when this label was last updated. You cannot change this value. */
            updated?: string;
        };
        "models.LabelTask": {
            /** @description A timestamp when this task was created. You cannot change this value. */
            created?: string;
            /** @description The label id you want to associate with a task. */
            label_id?: number;
        };
        "models.LabelTaskBulk": {
            /** @description All labels you want to update at once. */
            labels?: components["schemas"]["models.Label"][];
        };
        "models.LinkSharing": {
            /** @description A timestamp when this project was shared. You cannot change this value. */
            created?: string;
            /** @description The public id to get this shared project */
            hash?: string;
            /** @description The ID of the shared thing */
            id?: number;
            /** @description The name of this link share. All actions someone takes while being authenticated with that link will appear with that name. */
            name?: string;
            /** @description The password of this link share. You can only set it, not retrieve it after the link share has been created. */
            password?: string;
            /**
             * @description The permission this project is shared with. 0 = Read only, 1 = Read & Write, 2 = Admin. See the docs for more details.
             * @default 0
             */
            permission: components["schemas"]["models.Permission"];
            /** @description The user who shared this project */
            shared_by?: components["schemas"]["user.User"];
            /**
             * @description The kind of this link. 0 = undefined, 1 = without password, 2 = with password.
             * @default 0
             */
            sharing_type: components["schemas"]["models.SharingType"];
            /** @description A timestamp when this share was last updated. You cannot change this value. */
            updated?: string;
        };
        "models.Message": {
            /** @description A standard message. */
            message?: string;
        };
        "models.Overview": {
            license?: components["schemas"]["license.Info"];
            projects?: number;
            shares?: components["schemas"]["models.ShareCounts"];
            tasks?: number;
            teams?: number;
            users?: number;
        };
        /** @enum {integer} */
        "models.Permission": 0 | 1 | 2;
        "models.Project": {
            /** @description Contains a very small version of the project background to use as a blurry preview until the actual background is loaded. Check out https://blurha.sh/ to learn how it works. */
            background_blur_hash?: string;
            /** @description Holds extra information about the background set since some background providers require attribution or similar. If not null, the background can be accessed at /projects/{projectID}/background */
            background_information?: unknown;
            /** @description A timestamp when this project was created. You cannot change this value. */
            created?: string;
            /** @description The description of the project. */
            description?: string;
            /** @description The hex color of this project */
            hex_color?: string;
            /** @description The unique, numeric id of this project. */
            id?: number;
            /** @description The unique project short identifier. Used to build task identifiers. */
            identifier?: string;
            /** @description Whether a project is archived. */
            is_archived?: boolean;
            /** @description True if a project is a favorite. Favorite projects show up in a separate parent project. This value depends on the user making the call to the api. */
            is_favorite?: boolean;
            max_permission?: components["schemas"]["models.Permission"];
            /** @description The user who created this project. */
            owner?: components["schemas"]["user.User"];
            parent_project_id?: number;
            /** @description The position this project has when querying all projects. See the tasks.position property on how to use this. */
            position?: number;
            /**
             * @description The subscription status for the user reading this project. You can only read this property, use the subscription endpoints to modify it.
             *     Will only returned when retreiving one project.
             */
            subscription?: components["schemas"]["models.Subscription"];
            /** @description The title of the project. You'll see this in the overview. */
            title?: string;
            /** @description A timestamp when this project was last updated. You cannot change this value. */
            updated?: string;
            views?: components["schemas"]["models.ProjectView"][];
        };
        "models.ProjectDuplicate": {
            /** @description Whether to copy the project's shares to the duplicate */
            duplicate_shares?: boolean;
            /** @description The copied project */
            duplicated_project?: components["schemas"]["models.Project"];
            /** @description The target parent project */
            parent_project_id?: number;
        };
        "models.ProjectUser": {
            /** @description A timestamp when this relation was created. You cannot change this value. */
            created?: string;
            /** @description The unique, numeric id of this project <-> user relation. */
            id?: number;
            /**
             * @description The permission this user has. 0 = Read only, 1 = Read & Write, 2 = Admin. See the docs for more details.
             * @default 0
             */
            permission: components["schemas"]["models.Permission"];
            /** @description A timestamp when this relation was last updated. You cannot change this value. */
            updated?: string;
            /** @description The username. */
            username?: string;
        };
        "models.ProjectView": {
            /** @description When the bucket configuration mode is not `manual`, this field holds the options of that configuration. */
            bucket_configuration?: components["schemas"]["models.ProjectViewBucketConfiguration"][];
            /**
             * @description The bucket configuration mode. Can be `none`, `manual` or `filter`. `manual` allows to move tasks between buckets as you normally would. `filter` creates buckets based on a filter for each bucket.
             * @enum {string}
             */
            bucket_configuration_mode?: "none" | "manual" | "filter";
            /** @description A timestamp when this reaction was created. You cannot change this value. */
            created?: string;
            /** @description The ID of the bucket where new tasks without a bucket are added to. By default, this is the leftmost bucket in a view. */
            default_bucket_id?: number;
            /** @description If tasks are moved to the done bucket, they are marked as done. If they are marked as done individually, they are moved into the done bucket. */
            done_bucket_id?: number;
            /** @description The filter query to match tasks by. Check out https://vikunja.io/docs/filters for a full explanation. */
            filter?: components["schemas"]["models.TaskCollection"];
            /** @description The unique numeric id of this view */
            id?: number;
            /** @description The position of this view in the list. The list of all views will be sorted by this parameter. */
            position?: number;
            /** @description The project this view belongs to */
            project_id?: number;
            /** @description The title of this view */
            title?: string;
            /** @description A timestamp when this view was updated. You cannot change this value. */
            updated?: string;
            /**
             * @description The kind of this view. Can be `list`, `gantt`, `table` or `kanban`.
             * @enum {string}
             */
            view_kind?: "list" | "gantt" | "table" | "kanban";
        };
        "models.ProjectViewBucketConfiguration": {
            filter?: components["schemas"]["models.TaskCollection"];
            title?: string;
        };
        "models.Reaction": {
            /** @description A timestamp when this reaction was created. You cannot change this value. */
            created?: string;
            /** @description The user who reacted */
            user?: components["schemas"]["user.User"];
            /** @description The actual reaction. This can be any valid utf character or text, up to a length of 20. */
            value?: string;
        };
        "models.ReactionMap": {
            [key: string]: components["schemas"]["user.User"][];
        };
        "models.RelatedTaskMap": {
            [key: string]: components["schemas"]["models.Task"][];
        };
        /** @enum {string} */
        "models.RelationKind": "unknown" | "subtask" | "parenttask" | "related" | "duplicateof" | "duplicates" | "blocking" | "blocked" | "precedes" | "follows" | "copiedfrom" | "copiedto";
        /** @enum {string} */
        "models.ReminderRelation": "due_date" | "start_date" | "end_date";
        "models.RouteDetail": {
            method?: string;
            path?: string;
        };
        "models.SavedFilter": {
            /** @description A timestamp when this filter was created. You cannot change this value. */
            created?: string;
            /** @description The description of the filter */
            description?: string;
            /** @description The actual filters this filter contains */
            filters?: components["schemas"]["models.TaskCollection"];
            /** @description The unique numeric id of this saved filter */
            id?: number;
            /** @description True if the filter is a favorite. Favorite filters show up in a separate parent project together with favorite projects. */
            is_favorite?: boolean;
            /** @description The user who owns this filter */
            owner?: components["schemas"]["user.User"];
            /** @description The title of the filter. */
            title?: string;
            /** @description A timestamp when this filter was last updated. You cannot change this value. */
            updated?: string;
        };
        "models.ShareCounts": {
            link_shares?: number;
            team_shares?: number;
            user_shares?: number;
        };
        /** @enum {integer} */
        "models.SharingType": 0 | 1 | 2;
        "models.Subscription": {
            /** @description A timestamp when this subscription was created. You cannot change this value. */
            created?: string;
            entity?: number;
            /** @description The id of the entity to subscribe to. */
            entity_id?: number;
            /** @description The numeric ID of the subscription */
            id?: number;
        };
        "models.Task": {
            /** @description An array of users who are assigned to this task */
            assignees?: components["schemas"]["user.User"][];
            /** @description All attachments this task has. This property is read-onlym, you must use the separate endpoint to add attachments to a task. */
            attachments?: components["schemas"]["models.TaskAttachment"][];
            /**
             * @description The bucket id. Will only be populated when the task is accessed via a view with buckets.
             *     Can be used to move a task between buckets. In that case, the new bucket must be in the same view as the old one.
             */
            bucket_id?: number;
            /** @description All buckets across all views this task is part of. Only present when fetching tasks with the `expand` parameter set to `buckets`. */
            buckets?: components["schemas"]["models.Bucket"][];
            /** @description Comment count of this task. Only present when fetching tasks with the `expand` parameter set to `comment_count`. */
            comment_count?: number;
            /** @description All comments of this task. Only present when fetching tasks with the `expand` parameter set to `comments`. */
            comments?: components["schemas"]["models.TaskComment"][];
            /** @description If this task has a cover image, the field will return the id of the attachment that is the cover image. */
            cover_image_attachment_id?: number;
            /** @description A timestamp when this task was created. You cannot change this value. */
            created?: string;
            /** @description The user who initially created the task. */
            created_by?: components["schemas"]["user.User"];
            /**
             * @description A timestamp when this task was deleted. Soft-deleted tasks are kept for 30 days before they are removed permanently.
             *     omitzero keeps the field out of the JSON of regular tasks — it only ever appears on soft-deleted ones (the later trash listing).
             */
            deleted_at?: string;
            /** @description The task description. */
            description?: string;
            /** @description Whether a task is done or not. */
            done?: boolean;
            /** @description The time when a task was marked as done. This field is system-controlled and cannot be set via API. */
            done_at?: string;
            /** @description The time when the task is due. */
            due_date?: string;
            /** @description When this task ends. */
            end_date?: string;
            /** @description The task color in hex */
            hex_color?: string;
            /** @description The unique, numeric id of this task. */
            id?: number;
            /** @description The task identifier, based on the project identifier and the task's index */
            identifier?: string;
            /** @description The task index, calculated per project */
            index?: number;
            /** @description True if a task is a favorite task. Favorite tasks show up in a separate "Important" project. This value depends on the user making the call to the api. */
            is_favorite?: boolean;
            is_unread?: boolean;
            /** @description An array of labels which are associated with this task. This property is read-only, you must use the separate endpoint to add labels to a task. */
            labels?: components["schemas"]["models.Label"][];
            /** @description Determines how far a task is left from being done */
            percent_done?: number;
            /**
             * @description The position of the task - any task project can be sorted as usual by this parameter.
             *     When accessing tasks via views with buckets, this is primarily used to sort them based on a range.
             *     Positions are always saved per view. They will automatically be set if you request the tasks through a view
             *     endpoint, otherwise they will always be 0. To update them, take a look at the Task Position endpoint.
             */
            position?: number;
            /** @description The task priority. Can be anything you want, it is possible to sort by this later. */
            priority?: number;
            /** @description The project this task belongs to. */
            project_id?: number;
            /** @description Reactions on that task. */
            reactions?: components["schemas"]["models.ReactionMap"];
            /** @description All related tasks, grouped by their relation kind */
            related_tasks?: components["schemas"]["models.RelatedTaskMap"];
            /** @description An array of reminders that are associated with this task. */
            reminders?: components["schemas"]["models.TaskReminder"][];
            /** @description An amount in seconds this task repeats itself. If this is set, when marking the task as done, it will mark itself as "undone" and then increase all remindes and the due date by its amount. */
            repeat_after?: number;
            /** @description Can have three possible values which will trigger when the task is marked as done: 0 = repeats after the amount specified in repeat_after, 1 = repeats all dates each months (ignoring repeat_after), 3 = repeats from the current date rather than the last set date. */
            repeat_mode?: components["schemas"]["models.TaskRepeatMode"];
            /** @description When this task starts. */
            start_date?: string;
            /**
             * @description The subscription status for the user reading this task. You can only read this property, use the subscription endpoints to modify it.
             *     Will only returned when retrieving one task.
             */
            subscription?: components["schemas"]["models.Subscription"];
            /** @description Time entry count of this task. Only present when fetching tasks with the `expand` parameter set to `time_entries_count`. */
            time_entries_count?: number;
            /** @description The task text. This is what you'll see in the project. */
            title?: string;
            /** @description A timestamp when this task was last updated. You cannot change this value. */
            updated?: string;
        };
        "models.TaskAssginee": {
            created?: string;
            user_id?: number;
        };
        "models.TaskAttachment": {
            created?: string;
            created_by?: components["schemas"]["user.User"];
            file?: components["schemas"]["files.File"];
            id?: number;
            task_id?: number;
        };
        "models.TaskBucket": {
            bucket?: components["schemas"]["models.Bucket"];
            bucket_id?: number;
            /**
             * @description The view this bucket belongs to. Combined with TaskID this forms a
             *     unique index.
             */
            project_view_id?: number;
            task?: components["schemas"]["models.Task"];
            /**
             * @description The task which belongs to the bucket. Together with ProjectViewID
             *     this field is part of a unique index to prevent duplicates.
             */
            task_id?: number;
        };
        "models.TaskCollection": {
            /** @description The filter query to match tasks by. Check out https://vikunja.io/docs/filters for a full explanation. */
            filter?: string;
            /** @description If set to true, the result will also include null values */
            filter_include_nulls?: boolean;
            /** @description The query parameter to order the items by. This can be either asc or desc, with asc being the default. */
            order_by?: string[];
            s?: string;
            /** @description The query parameter to sort by. This is for ex. done, priority, etc. */
            sort_by?: string[];
        };
        "models.TaskComment": {
            author?: components["schemas"]["user.User"];
            comment?: string;
            created?: string;
            id?: number;
            reactions?: components["schemas"]["models.ReactionMap"];
            updated?: string;
        };
        "models.TaskDuplicate": {
            /** @description The duplicated task */
            duplicated_task?: components["schemas"]["models.Task"];
        };
        "models.TaskPosition": {
            /**
             * @description The position of the task - any task project can be sorted as usual by this parameter.
             *     When accessing tasks via kanban buckets, this is primarily used to sort them based on a range
             *     We're using a float64 here to make it possible to put any task within any two other tasks (by changing the number).
             *     You would calculate the new position between two tasks with something like task3.position = (task2.position - task1.position) / 2.
             *     A 64-Bit float leaves plenty of room to initially give tasks a position with 2^16 difference to the previous task
             *     which also leaves a lot of room for rearranging and sorting later.
             *     Positions are always saved per view. They will automatically be set if you request the tasks through a view
             *     endpoint, otherwise they will always be 0. To update them, take a look at the Task Position endpoint.
             */
            position?: number;
            /** @description The project view this task is related to */
            project_view_id?: number;
            /** @description The ID of the task this position is for */
            task_id?: number;
        };
        "models.TaskRelation": {
            /** @description A timestamp when this label was created. You cannot change this value. */
            created?: string;
            /** @description The user who created this relation */
            created_by?: components["schemas"]["user.User"];
            /** @description The ID of the other task, the task which is being related. */
            other_task_id?: number;
            /**
             * @description The kind of the relation.
             *     The enum list must stay in sync with RelationKind.isValid() (RelationKindUnknown excluded); the v2 delete route param repeats it.
             */
            relation_kind?: components["schemas"]["models.RelationKind"];
            /** @description The ID of the "base" task, the task which has a relation to another. */
            task_id?: number;
        };
        "models.TaskReminder": {
            /** @description A period in seconds relative to another date argument. Negative values mean the reminder triggers before the date. Default: 0, tiggers when RelativeTo is due. */
            relative_period?: number;
            /** @description The name of the date field to which the relative period refers to. */
            relative_to?: components["schemas"]["models.ReminderRelation"];
            /** @description The absolute time when the user wants to be reminded of the task. */
            reminder?: string;
        };
        /** @enum {integer} */
        "models.TaskRepeatMode": 0 | 1 | 2;
        "models.TaskUnreadStatus": {
            taskID?: number;
            userID?: number;
        };
        "models.Team": {
            /** @description A timestamp when this relation was created. You cannot change this value. */
            created?: string;
            /** @description The user who created this team. */
            created_by?: components["schemas"]["user.User"];
            /** @description The team's description. */
            description?: string;
            /** @description The team's external id provided by the openid or ldap provider */
            external_id?: string;
            /** @description The unique, numeric id of this team. */
            id?: number;
            /** @description Defines wether the team should be publicly discoverable when sharing a project */
            is_public?: boolean;
            /** @description An array of all members in this team. */
            members?: components["schemas"]["models.TeamUser"][];
            /** @description The name of this team. */
            name?: string;
            /** @description A timestamp when this relation was last updated. You cannot change this value. */
            updated?: string;
        };
        "models.TeamMember": {
            /** @description Whether or not the member is an admin of the team. See the docs for more about what a team admin can do */
            admin?: boolean;
            /** @description A timestamp when this relation was created. You cannot change this value. */
            created?: string;
            /** @description The unique, numeric id of this team member relation. */
            id?: number;
            /** @description The username of the member. We use this to prevent automated user id entering. */
            username?: string;
        };
        "models.TeamProject": {
            /** @description A timestamp when this relation was created. You cannot change this value. */
            created?: string;
            /** @description The unique, numeric id of this project <-> team relation. */
            id?: number;
            /**
             * @description The permission this team has. 0 = Read only, 1 = Read & Write, 2 = Admin. See the docs for more details.
             * @default 0
             */
            permission: components["schemas"]["models.Permission"];
            /** @description The team id. */
            team_id?: number;
            /** @description A timestamp when this relation was last updated. You cannot change this value. */
            updated?: string;
        };
        "models.TeamUser": {
            /** @description Whether the member is an admin of the team. See the docs for more about what a team admin can do */
            admin?: boolean;
            /**
             * @description BotOwnerID is the ID of the owning (human) user if this user is a bot.
             *     A non-zero value means this user is a bot and cannot authenticate via password.
             */
            bot_owner_id?: number;
            /** @description A timestamp when this task was created. You cannot change this value. */
            created?: string;
            /** @description The user's email address. */
            email?: string;
            /** @description The unique, numeric id of this user. */
            id?: number;
            /** @description The full name of the user. */
            name?: string;
            /** @description A timestamp when this task was last updated. You cannot change this value. */
            updated?: string;
            /** @description The username of the user. Is always unique. */
            username?: string;
        };
        "models.TeamWithPermission": {
            /** @description A timestamp when this relation was created. You cannot change this value. */
            created?: string;
            /** @description The user who created this team. */
            created_by?: components["schemas"]["user.User"];
            /** @description The team's description. */
            description?: string;
            /** @description The team's external id provided by the openid or ldap provider */
            external_id?: string;
            /** @description The unique, numeric id of this team. */
            id?: number;
            /** @description Defines wether the team should be publicly discoverable when sharing a project */
            is_public?: boolean;
            /** @description An array of all members in this team. */
            members?: components["schemas"]["models.TeamUser"][];
            /** @description The name of this team. */
            name?: string;
            permission?: components["schemas"]["models.Permission"];
            /** @description A timestamp when this relation was last updated. You cannot change this value. */
            updated?: string;
        };
        "models.UserExportStatus": {
            created?: string;
            expires?: string;
            id?: number;
            size?: number;
        };
        "models.UserGeneralSettings": {
            default_project_id?: number;
            discoverable_by_email?: boolean;
            discoverable_by_name?: boolean;
            email_reminders_enabled?: boolean;
            /** @description Server/OpenID-provided; populated on read, ignored on write. */
            extra_settings_links?: {
                [key: string]: unknown;
            };
            frontend_settings?: unknown;
            language?: string;
            name?: string;
            overdue_tasks_reminders_enabled?: boolean;
            overdue_tasks_reminders_time?: string;
            timezone?: string;
            week_start?: number;
        };
        "models.UserWithPermission": {
            /**
             * @description BotOwnerID is the ID of the owning (human) user if this user is a bot.
             *     A non-zero value means this user is a bot and cannot authenticate via password.
             */
            bot_owner_id?: number;
            /** @description A timestamp when this task was created. You cannot change this value. */
            created?: string;
            /** @description The user's email address. */
            email?: string;
            /** @description The unique, numeric id of this user. */
            id?: number;
            /** @description The full name of the user. */
            name?: string;
            permission?: components["schemas"]["models.Permission"];
            /** @description A timestamp when this task was last updated. You cannot change this value. */
            updated?: string;
            /** @description The username of the user. Is always unique. */
            username?: string;
        };
        "models.Webhook": {
            basic_auth_password?: string;
            /** @description If provided, webhook requests will be sent with a Basic Auth header. */
            basic_auth_user?: string;
            /** @description A timestamp when this webhook target was created. You cannot change this value. */
            created?: string;
            /** @description The user who initially created the webhook target. */
            created_by?: components["schemas"]["user.User"];
            /** @description The webhook events which should fire this webhook target */
            events?: string[];
            /** @description The generated ID of this webhook target */
            id?: number;
            /** @description The project ID of the project this webhook target belongs to */
            project_id?: number;
            /** @description If provided, webhook requests will be signed using HMAC. Check out the docs about how to use this: https://vikunja.io/docs/webhooks/#signing */
            secret?: string;
            /** @description The target URL where the POST request with the webhook payload will be made */
            target_url?: string;
            /** @description A timestamp when this webhook target was last updated. You cannot change this value. */
            updated?: string;
            /** @description The user ID if this is a user-level webhook (mutually exclusive with ProjectID) */
            user_id?: number;
        };
        "notifications.DatabaseNotification": {
            /** @description A timestamp when this notification was created. You cannot change this value. */
            created?: string;
            /** @description The unique, numeric id of this notification. */
            id?: number;
            /** @description The name of the notification */
            name?: string;
            /** @description The actual content of the notification. */
            notification?: unknown;
            /** @description When this notification is marked as read, this will be updated with the current timestamp. */
            read_at?: string;
        };
        "openid.Callback": {
            code?: string;
            redirect_url?: string;
            scope?: string;
            /**
             * @description TOTPPasscode is required when the resolved user has TOTP enabled.
             *     Clients must restart the OIDC flow and populate this field after
             *     receiving a 412 with error code 1017. See GHSA-8jvc-mcx6-r4cg.
             */
            totp_passcode?: string;
        };
        "shared.AdminUser": {
            auth_provider?: string;
            /**
             * @description BotOwnerID is the ID of the owning (human) user if this user is a bot.
             *     A non-zero value means this user is a bot and cannot authenticate via password.
             */
            bot_owner_id?: number;
            /** @description A timestamp when this task was created. You cannot change this value. */
            created?: string;
            /** @description The user's email address. */
            email?: string;
            /** @description The unique, numeric id of this user. */
            id?: number;
            is_admin?: boolean;
            issuer?: string;
            /** @description The full name of the user. */
            name?: string;
            status?: components["schemas"]["user.Status"];
            subject?: string;
            /** @description A timestamp when this task was last updated. You cannot change this value. */
            updated?: string;
            /** @description The username of the user. Is always unique. */
            username?: string;
        };
        "shared.AuthInfo": {
            ldap?: components["schemas"]["shared.LdapAuthInfo"];
            local?: components["schemas"]["shared.LocalAuthInfo"];
            openid_connect?: components["schemas"]["shared.OpenIDAuthInfo"];
        };
        "shared.LdapAuthInfo": {
            enabled?: boolean;
        };
        "shared.LegalInfo": {
            imprint_url?: string;
            privacy_policy_url?: string;
        };
        "shared.LocalAuthInfo": {
            enabled?: boolean;
            registration_enabled?: boolean;
        };
        "shared.OpenIDAuthInfo": {
            enabled?: boolean;
            providers?: components["schemas"]["code_vikunja_io_api_pkg_modules_auth_openid.Provider"][];
        };
        "shared.VikunjaInfos": {
            allow_icon_changes?: boolean;
            auth?: components["schemas"]["shared.AuthInfo"];
            available_migrators?: string[];
            caldav_enabled?: boolean;
            /** @description ConcurrentWrites reports whether the configured database can handle concurrent writes. It is false on SQLite, where overlapping write transactions deadlock, so clients should serialize batched writes instead of firing them in parallel. */
            concurrent_writes?: boolean;
            demo_mode_enabled?: boolean;
            email_reminders_enabled?: boolean;
            enabled_background_providers?: string[];
            enabled_pro_features?: components["schemas"]["license.Feature"][];
            frontend_url?: string;
            legal?: components["schemas"]["shared.LegalInfo"];
            link_sharing_enabled?: boolean;
            max_file_size?: string;
            max_items_per_page?: number;
            motd?: string;
            public_teams_enabled?: boolean;
            task_attachments_enabled?: boolean;
            task_comments_enabled?: boolean;
            totp_enabled?: boolean;
            user_deletion_enabled?: boolean;
            version?: string;
            webhooks_enabled?: boolean;
        };
        "todoist.Migration": {
            code?: string;
        };
        "trello.Migration": {
            code?: string;
        };
        "user.EmailConfirm": {
            /** @description The email confirm token sent via email. */
            token?: string;
        };
        "user.EmailUpdate": {
            /** @description The new email address. Needs to be a valid email address. */
            new_email?: string;
            /** @description The password of the user for confirmation. */
            password?: string;
        };
        "user.Login": {
            /** @description If true, the token returned will be valid a lot longer than default. Useful for "remember me" style logins. */
            long_token?: boolean;
            /** @description The password for the user. */
            password?: string;
            /** @description The totp passcode of a user. Only needs to be provided when enabled. */
            totp_passcode?: string;
            /** @description The username used to log in. */
            username?: string;
        };
        "user.PasswordReset": {
            /** @description The new password for this user. */
            new_password?: string;
            /** @description The previously issued reset token. */
            token?: string;
        };
        "user.PasswordTokenRequest": {
            email?: string;
        };
        /** @enum {integer} */
        "user.Status": 0 | 1 | 2 | 3;
        "user.TOTP": {
            /** @description The totp entry will only be enabled after the user verified they have a working totp setup. */
            enabled?: boolean;
            secret?: string;
            /** @description The totp url used to be able to enroll the user later */
            url?: string;
        };
        "user.TOTPPasscode": {
            passcode?: string;
        };
        "user.Token": {
            created?: string;
            id?: number;
            token?: string;
        };
        "user.User": {
            /**
             * @description BotOwnerID is the ID of the owning (human) user if this user is a bot.
             *     A non-zero value means this user is a bot and cannot authenticate via password.
             */
            bot_owner_id?: number;
            /** @description A timestamp when this task was created. You cannot change this value. */
            created?: string;
            /** @description The user's email address. */
            email?: string;
            /** @description The unique, numeric id of this user. */
            id?: number;
            /** @description The full name of the user. */
            name?: string;
            /** @description A timestamp when this task was last updated. You cannot change this value. */
            updated?: string;
            /** @description The username of the user. Is always unique. */
            username?: string;
        };
        "v1.LinkShareAuth": {
            password?: string;
        };
        "v1.LogoutResponse": {
            message?: string;
            /** @description RP-Initiated Logout URL the frontend redirects to. Empty for non-OIDC sessions. */
            oidc_logout_url?: string;
        };
        "v1.UserAvatarProvider": {
            /** @description The avatar provider. Valid types are `gravatar` (uses the user email), `upload`, `initials`, `marble` (generates a random avatar for each user), `ldap` (synced from LDAP server), `openid` (synced from OpenID provider), `default`. */
            avatar_provider?: string;
        };
        "v1.UserDeletionRequestConfirm": {
            token?: string;
        };
        "v1.UserPassword": {
            new_password?: string;
            old_password?: string;
        };
        "v1.UserPasswordConfirmation": {
            password?: string;
        };
        "v1.UserRegister": {
            /** @description The user's email address */
            email?: string;
            /** @description The language of the new user. Must be a valid IETF BCP 47 language code and exist in Vikunja. */
            language?: string;
            /** @description The user's password in clear text. Only used when registering the user. The maximum limi is 72 bytes, which may be less than 72 characters. This is due to the limit in the bcrypt hashing algorithm used to store passwords in Vikunja. */
            password?: string;
            /** @description The user's username. Cannot contain anything that looks like an url or whitespaces. */
            username?: string;
        };
        "v1.UserWithSettings": {
            auth_provider?: string;
            /**
             * @description BotOwnerID is the ID of the owning (human) user if this user is a bot.
             *     A non-zero value means this user is a bot and cannot authenticate via password.
             */
            bot_owner_id?: number;
            /** @description A timestamp when this task was created. You cannot change this value. */
            created?: string;
            deletion_scheduled_at?: string;
            /** @description The user's email address. */
            email?: string;
            /** @description The unique, numeric id of this user. */
            id?: number;
            is_admin?: boolean;
            is_local_user?: boolean;
            /** @description The full name of the user. */
            name?: string;
            settings?: components["schemas"]["models.UserGeneralSettings"];
            /** @description A timestamp when this task was last updated. You cannot change this value. */
            updated?: string;
            /** @description The username of the user. Is always unique. */
            username?: string;
        };
        "web.HTTPError": {
            code?: number;
            /** @description I18nParams carries Message's dynamic values, keyed by the client's translation placeholder names, so clients can localise the error. */
            i18n_params?: {
                [key: string]: string;
            };
            message?: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: {
        /** @description The bucket object */
        "models.Bucket": {
            content: {
                "application/json": components["schemas"]["models.Bucket"];
            };
        };
        /** @description The task object */
        "models.Task": {
            content: {
                "application/json": components["schemas"]["models.Task"];
            };
        };
        /** @description The label object */
        "models.Label": {
            content: {
                "application/json": components["schemas"]["models.Label"];
            };
        };
        /** @description The relation object */
        "models.TaskRelation": {
            content: {
                "application/json": components["schemas"]["models.TaskRelation"];
            };
        };
        /** @description The reaction you want to add to the entity. */
        "models.Reaction": {
            content: {
                "application/json": components["schemas"]["models.Reaction"];
            };
        };
    };
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    "get-token-openid": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The OpenID Connect provider key as returned by the /info endpoint */
                provider: number;
            };
            cookie?: never;
        };
        /** @description The openid callback */
        requestBody: {
            content: {
                "application/json": components["schemas"]["openid.Callback"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["auth.Token"];
                };
            };
            /** @description Invalid totp passcode. */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["models.Message"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["models.Message"];
                };
            };
        };
    };
}
