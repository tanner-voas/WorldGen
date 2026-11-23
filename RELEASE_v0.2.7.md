# WorldGen v0.2.7 — release test hygiene

- Fixed historical version assertions in `tests/v0222.test.js` and `tests/v204.test.js` so that tests compare the current application version with `package.json`.
- Corrected the reported application version to 0.2.7.
- No generated world content, persistence schema, rendering behavior, or stage algorithms were modified.
- Intended to make full-app release validation green again.
