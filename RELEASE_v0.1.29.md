# WorldGen v0.1.29 — safe startup and recovery

## Scope

- Failed IndexedDB reads, invalid worlds, and unreadable checkpoint libraries no longer open an editable default world. The recovery screen prevents generation, autosave, and visibility-change writes until startup succeeds.
- Retry storage without reloading; export the original readable working record; export or explicitly restore a verified named checkpoint; or explicitly start a replacement world. Replacements re-read storage and require a completed transaction before the editor opens. If reading storage still fails, the app stays in recovery instead of risking an overwrite.
- Distinguish a confirmed missing record from invalid or failed records, including stored `undefined`. Read operations wait for their transaction to complete, and a blocked database open closes any late connection. Retry is supported after temporary database failures.
- Startup-only legacy migration writes its index, checkpoint records, and marker atomically. Invalid legacy checkpoint contents are preserved rather than silently discarded. Normal checkpoint operations are unchanged and remain the subject of the next persistence release.
- No generation changes, renderer changes, save-schema changes, or AppLauncher changes.

## Validation

The Node regression suite covers fresh and valid startup, read failures, corrupt records, independent checkpoint export, failed transactions, explicit replacement confirmation, legacy migration, delayed commits, and the actual app mounting a recovery-only interface with an unavailable database. Both distribution builds include the startup module. The packaged browser navigation was blocked by the test environment; native Safari/IndexedDB interaction has not been verified.
