# 0026. Electron shell starts the local server on a free port

**Status:** Accepted
**Date:** 2026-11-11

## Context

The local web UI already covers the review loop. A desktop app should not fork
it or duplicate business logic. It also should not bind a fixed port that may be
taken by another process.

## Decision

Add an Electron main process in `packages/desktop`.

- Ask for a project folder, or accept `WINNOW_PROJECT`.
- Spawn the built server with `WINNOW_PORT=0` and `WINNOW_READY_JSON=1`.
- Wait for the `WINNOW_READY {"port":…}` line, then load
  `http://127.0.0.1:<port>/` in a `BrowserWindow`.
- Use `contextIsolation: true`, `sandbox: true`, and no Node integration.
- Open external links in the system browser.
- Kill the server when the app quits.
- Keep installers, notarization and first-run model setup for the next step.

## Consequences

- Desktop is a shell over the same UI and core; there is no second implementation.
- Port conflicts disappear because the OS assigns the port.
- The UI is only reachable on localhost and writes still require the session
  token.
- Packaging needs the server, core and web builds inside the app bundle. That
  bundling and signing work is deferred; this is a development shell.
- The shell relies on Electron's Node runtime (`ELECTRON_RUN_AS_NODE`) to run the
  server.
