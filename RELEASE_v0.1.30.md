# WorldGen v0.1.30 — Persistence optimization

Roadmap release following the safe-startup changes in v0.1.29. No changes to the 12 generation layers, renderer, AppLauncher integration, or JSON save schema.

## Changes

- Map viewport, selected historical layer, display palette, overlay flags and expanded map preference save to `workspace-preferences`, a compact sidecar associated with the working world's ID and saved revision timestamp. Full saves continue to embed the current preferences for self-contained exports and delete the old sidecar in the same transaction. Startup ignores malformed, stale or unavailable optional preferences without replacing the world. Explicit recovery replacements and legacy world migrations also clear stale preferences atomically.
- One coalescing autosave writer tracks world and preference changes separately. Idle flushes perform no writes, navigation changes do not clone or rewrite generated terrain, and repeated pan gestures cannot postpone an already scheduled world-data write. Edits during an in-flight write are saved in a subsequent transaction; failed writes retain their dirty flags for retry. The app flushes pending changes on visibility loss/page hide and when returning to the launcher (browser shutdown may interrupt asynchronous writes).
- Save status reflects pending/saving/failed/committed state. Leaving for the launcher after a failed flush requires explicit confirmation. Generation progress remains separate from committed-storage state.
- Checkpoint creation and deletion read the latest persisted index, update both index and world payload within one IndexedDB read/write transaction, and publish the new index only after successful completion. Aborts roll back both changes; invalid indexes and duplicate checkpoint IDs are rejected. Existing checkpoints are not migrated or deleted.

## Verification

- 165 Node automated tests (150 existing plus 15 new), including coalescing, immutable in-flight snapshots, failed-save retry, no-op flush, optional preferences, world switch/recovery, and simulated transaction rollback and overlap.
- Standalone and AppLauncher module packaging; new modules included in the offline cache.
- Local Chromium navigation to the packaged app was blocked by the test environment (`ERR_BLOCKED_BY_ADMINISTRATOR`); native IndexedDB/Safari integration is not claimed. Automated transaction models exercise the production request and completion code but are not substitutes for a real-device test.

Existing v0.1.29 databases and exported worlds remain readable without a save-schema upgrade. Older app versions ignore the sidecar and use the preferences embedded in the last full world save. Keep external backups of important worlds; browser storage can be evicted independently of this application.
