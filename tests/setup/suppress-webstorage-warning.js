/**
 * Prevents Node's "--localstorage-file was provided without a valid path"
 * warning during test runs.
 *
 * Root cause (confirmed by tracing the getter with a diagnostic preload):
 * Node 24+ ships an experimental `globalThis.localStorage` (webstorage)
 * global that lazily initializes — and prints this warning — the first time
 * it's *read*, not merely referenced. `jest-environment-node`'s own
 * `NodeEnvironment` constructor triggers that read itself: it snapshots
 * `Object.getOwnPropertyNames(globalThis)` once at module-load time (minus a
 * small internal denylist that doesn't include `localStorage`), then, for
 * every test file's sandbox environment, calls jest-util's
 * `protectProperties()` on each of those globals — which reads the property
 * to freeze/harden it. That read is what lazily initializes Node's
 * webstorage backing store and prints the warning, once per Node process
 * (13 workers in parallel mode == 13 warnings; 1 warning with
 * `--runInBand`). This project never uses `localStorage`; it's an
 * unrequested Jest/Node interaction, not a signal about our code or tests.
 *
 * Fix: delete `globalThis.localStorage` before jest-environment-node's
 * module is ever loaded, so its one-time `Object.getOwnPropertyNames(
 * globalThis)` snapshot never sees the property in the first place, and
 * nothing ever triggers its lazy init. That's why this file is loaded via
 * `NODE_OPTIONS="--require .../this-file.js"` (see package.json's test
 * scripts) rather than Jest's `setupFiles` — `setupFiles` run per test file,
 * inside an environment that jest-environment-node has already constructed,
 * which is too late.
 *
 * Two things that look plausible but do NOT work, tried and rejected here:
 *   - `--no-experimental-webstorage` (CLI flag or NODE_OPTIONS): the flag
 *     doesn't exist before Node ~24 (the feature itself didn't ship on Node
 *     20, this project's documented minimum per `.nvmrc`/`engines`), and an
 *     unrecognized flag in NODE_OPTIONS is a hard "not allowed in
 *     NODE_OPTIONS" startup error, not a no-op — it would break `npm test`
 *     outright on Node 20.
 *   - `process.on('warning', ...)`: doesn't reliably intercept this specific
 *     warning in practice (verified empirically) — registering a listener
 *     even before any Jest module loads still let the raw warning through.
 *
 * The `delete` below is a no-op on any Node version that doesn't have the
 * property (Node 20 included — `'localStorage' in globalThis` is simply
 * `false`), so it's safe unmodified across the whole supported Node range.
 */
if ('localStorage' in globalThis) {
  delete globalThis.localStorage;
}
if ('sessionStorage' in globalThis) {
  delete globalThis.sessionStorage;
}
