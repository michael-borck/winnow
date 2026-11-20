# 0027. Electron updater follows the app-hq fleet pattern

**Status:** Accepted
**Date:** 2026-11-18

## Context

ADR-0026 accepted packaging/signing as deferred. The builder config has since
grown the fleet-standard shape (afterSign notarize hook, hardened runtime,
GitHub publish), and the release workflow already publishes `latest.yml` with
every `v*` tag via app-hq's composite workflow. The one missing piece was the
in-app updater: installs were manual reinstalls.

## Decision

Adopt the app-hq Electron updater convention
([templates/electron](https://github.com/michael-borck/app-hq/tree/main/templates/electron)):

- `electron-updater` as a runtime dependency of `packages/desktop`.
- Silent check on launch: `autoUpdater.checkForUpdatesAndNotify()` starts
  30 seconds after `whenReady`, skipped in unpackaged dev runs. Updates apply
  on next restart.
- Update source is the GitHub Release produced by the existing tag workflow
  (`provider: github` in the builder config; `latest.yml` is the manifest).

## Consequences

- Shipping an update is now: cut a `v*` tag. Users get a notification and
  the update lands on restart.
- Unsigned development builds skip the check (`app.isPackaged` guard).
- Windows NSIS and macOS zip targets update in place; AppImage/deb Linux
  users update via re-download until a linux updater target is added.
- Matches the convention in talk-buddy and the lens-desktop family, so the
  fleet has one update story.
