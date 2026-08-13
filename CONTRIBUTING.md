# Contributing to Straightedge

Thanks for helping make diagram editing more predictable. Straightedge intentionally supports a
narrow Mermaid subset, so concrete diagrams and precisely described visual intent are especially
valuable.

## Development setup

Use Node.js 22 or newer and a machine that can run Chromium:

```bash
git clone https://github.com/gmjen/straightedge.git
cd straightedge
npm ci
npm run build
npm run test:all
```

`npm test` runs the fast domain suite. `npm run test:e2e` renders in a real browser, and
`npm run test:package` verifies the installed tarball contract. Generated `dist/`, coverage,
diagram output, and local recovery files must not be committed.

## Issues and fixtures

For diagram-quality reports, include a sanitized `.mmd` fixture, the exact instruction that was
surprising, the actual output, and the desired result. Preserve stable Mermaid node IDs. Do not
attach private diagrams, tokens, or browser profiles. Security reports belong in the private
channel described in [SECURITY.md](./SECURITY.md), not a public issue.

## Changes and ADRs

Keep layout operations pure and deterministic. A new persistent operation, sidecar semantic,
security boundary, or compatibility promise requires an ADR under `docs/adr/`. Small fixes can
update an existing ADR when they do not change its decision. Tests should cover changed-baseline
replay, unequal node sizes, stale IDs, and browser paint when the DOM is involved.

## Pull requests

- Keep each pull request focused and explain the user journey it improves.
- Add or adjust tests; retire a test only when its former contract is explicitly obsolete.
- Run `npm run test:all` from a clean worktree.
- Confirm `git status --ignored` contains no accidental source, credentials, backups, or outputs.
- Update README, CHANGELOG, SPEC, and ADRs when their public contract changes.

Contributions are accepted under the repository's [Apache License 2.0](./LICENSE).
