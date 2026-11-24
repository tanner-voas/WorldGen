# WorldGen v0.2.9 — roadmap 7B

- Pin PWA-Core v0.1.0 (`e5f634e86c8230cd0a8557c52b4ff83d2b31db2d`) as `shared/pwa-core`.
- Generate the standalone worker and fingerprint inventory with the pinned library; keep cache scope and namespace, `/_profiles/` bypass, and existing asset classification.
- Copy the shared update implementation into the established runtime path; preserve AppLauncher's authority when hosted.
- No changes to domain algorithms, saved data, service-worker registration, manifest identity or cloud contracts.
- Build/test with initialized pinned submodules. The existing release coordinator validates the complete hosted build and promotes production.
