# ADR-0007: Initial open-source commit readiness

- **Status:** Accepted and implemented; validated on local and public CI
- **Date:** 2026-08-12
- **Decision scope:** Work required before Straightedge's first public Git commit and first npm
  prerelease
- **Supersedes:** None
- **Related:** ADR-0001, especially the trust-first ordering and flowchart breadth gate
- **Reserved ADRs:** ADR-0002 through ADR-0006 retain the topics assigned by ADR-0001

## 1. Decision

Straightedge will make one focused trust-and-first-run pass before its initial public commit. The
pass will not add another Mermaid diagram family, subgraphs, a plugin ecosystem, cloud services,
or a general drawing surface.

The first public commit must make four promises true in the way a new user will naturally
understand them:

1. **Honest:** passing automated checks means that no checked blocking problem was detected; it
   does not mean that an inherently subjective diagram is presentation-ready.
2. **Deterministic:** an explicitly ordered command produces that order on every replay.
3. **Recoverable:** undo, reset, compaction, and editor actions cannot silently destroy the active
   sidecar or unsaved Mermaid source.
4. **Immediate:** a fresh clone can install, test, render, edit, undo, and package Straightedge by
   following copy-pasteable documentation.

The work is divided into a release-blocking initial-commit scope and a clearly named post-commit
scope. This distinction prevents useful feedback from turning into another open-ended feature
roadmap.

### Release-blocking scope

- accurate success language and diagnostic-profile reporting;
- deterministic ordering, including `row` and `stack` semantic operations;
- operation history and explanation of effective intent;
- atomic CLI undo and recoverable reset;
- editor dirty-state, partial resize, zoom/fit, keyboard undo/redo, inline-error, and selection-order
  hardening;
- repository, legal, package, documentation, CI, security, and clean-clone packaging hygiene;
- a committed, reproducible before/after visual near the top of the README.

### Explicit post-commit scope

- org-chart tree layout and port/rail routing;
- general presentation-quality heuristics beyond the small warning set defined here;
- semantic compaction that is more aggressive than locally provable rewrites;
- named checkpoints;
- subgraphs, additional Mermaid diagram families, custom theme packs, and remote collaboration.

## 2. Relationship to ADR-0001

This ADR narrows and operationalizes ADR-0001; it does not reverse its architecture.

The following ADR-0001 decisions remain binding:

- ordinary Mermaid is the semantic source;
- replayable operations are the persistent visual intent;
- CLI, MCP, and editor mutations share one transaction engine;
- errors block a commit, safe repair is explicit, and unsupported input fails clearly;
- flowchart trust precedes diagram-family breadth.

ADR-0001 uses the machine status `clean`. That status remains for compatibility. This ADR changes
the human claim attached to it. The initial OSS release will say:

> No blocking problems were detected by the active checks.

It will not say “visually clean,” “presentation-ready,” “good,” or an equivalent subjective claim.
Every structured result will include the active diagnostic profile and the checks that actually
ran, so callers can distinguish geometry certification from presentation guidance.

## 3. Pre-decision evidence and gap

The v0.2 implementation has a strong engine and meaningful automated coverage. It already has
atomic multi-operation transactions, browser-derived label checks, presentation frames, curated
themes, obstacle-aware rerouting, a loopback editor, CLI/MCP parity, and a reusable browser session.

Real deck work exposed a gap between those mechanical guarantees and user inference:

- an org chart could pass all current checks while retaining a long, awkward connector and an
  unintuitive hierarchy;
- `distribute` sorts by existing position, even when the caller supplies a deliberate node order;
- accumulated sidecar operations can contradict `flowchart TB` without a concise explanation;
- editor redraw can replace unsaved source edits;
- an empty resize input is converted to zero by the editor;
- CLI undo and reset do not yet express the same rollback guarantees as normal transactions;
- the repository is not a Git worktree and has no `.gitignore`, root `LICENSE`, GitHub workflow, or
  community policy files;
- `.DS_Store`, a 237 MB `node_modules`, and generated `dist` are present locally;
- package identity metadata and a clean-checkout pack test are absent;
- the README still contains a placeholder where the product's essential before/after proof should
  be.

The default local `npm pack --dry-run` is additionally blocked by root-owned files in the user's
global npm cache. Using an isolated temporary cache succeeds and reports 67,108 compressed bytes
across 66 files. The manifest contains README, SPEC, package metadata, and `dist`, but no root
LICENSE because none exists. That machine condition is not a project defect, and the isolated run
confirms the feedback's healthy size estimate; both observations reinforce that packaging must be
verified in a clean environment rather than inferred from one workstation.

## 4. Product language and diagnostic profiles

### 4.1 Machine status remains stable

The result status remains:

| Status | Meaning |
|---|---|
| `clean` | No error or warning was reported by the active profile |
| `review` | No blocking error, but at least one warning needs judgment |
| `failed` | A blocking diagnostic, invalid input, or required runtime failure occurred |

The status describes a check result, not an aesthetic judgment.

### 4.2 Every result reports its scope

`StraightedgeResult` will add:

```ts
interface CheckSummary {
  profile: "geometry" | "presentation";
  completed: boolean;
  checks: Array<{
    name: string;
    status: "passed" | "warning" | "failed" | "skipped";
  }>;
  claim: string;
}
```

The `claim` is generated by Straightedge and is identical across CLI JSON and MCP
`structuredContent`. A skipped required browser stage makes `completed: false` and the overall
status `failed`.

### 4.3 Profiles

- `geometry` runs parse, replay, label/shape containment, overlap, gap, edge/node crossing,
  arrowhead, stale-operation, and runtime checks.
- `presentation` includes all geometry checks plus target-frame readability and the advisory
  heuristics below.
- Supplying a presentation frame automatically activates `presentation`; otherwise `geometry` is
  the default.
- `check --profile presentation` allows presentation guidance without persisting a frame.

Initial advisory presentation problems are warnings, never errors:

| Problem | Initial rule |
|---|---|
| `long_connector` | Routed length exceeds both four median node widths and 45% of the canvas diagonal |
| `excessive_dogleg` | More than three bends, or route length exceeds 1.75 times endpoint Manhattan distance |
| `direction_contradiction` | A majority of edited connected pairs are arranged perpendicular or opposite to the Mermaid direction |
| `excessive_whitespace` | Node/edge content occupies less than 18% of an active target frame |

The exact measured values and thresholds are returned as evidence. A user can suppress a specific
advisory for one invocation with `--suppress <problem-id>` or choose the geometry profile. Initial
suppression is request-scoped and is not persisted. Suppression never hides an error.

Asymmetric sibling routing and hierarchy port rules are deferred until org-chart routing exists;
reporting them without understanding hierarchy would create noisy false positives.

## 5. Deterministic ordering

### 5.1 Separate given order from current order

`distribute_nodes` will gain an explicit order policy:

```ts
interface DistributeNodes {
  op: "distribute_nodes";
  nodes: string[];
  axis: "horizontal" | "vertical";
  gap?: number;
  order?: "given" | "current";
}
```

Rules:

- all new CLI, MCP, and editor operations persist `order` explicitly;
- CLI and MCP default to `given`, because argument order is deliberate user input;
- the editor defaults to visible selection order and displays that order numerically;
- `--order current` retains the existing position-sorted behavior;
- duplicate node IDs are rejected;
- `given` anchors the first listed node's leading coordinate and places every later node in list
  order using its actual size and the requested or computed gap;
- omitted `order` in an existing v1 or v2 sidecar continues to mean `current`, preserving replay of
  existing diagrams.

The command from the feedback therefore has one guaranteed result:

```bash
straightedge distribute chart.mmd ingest enrich model database \
  --axis horizontal --order given
```

The four nodes appear left-to-right in that order. The persisted operation includes
`"order": "given"`, so a later baseline cannot reinterpret it.

### 5.2 Sidecar v3

New ordering and high-level semantic operations promote the sidecar to version 3. Straightedge
continues to read v1 and v2 indefinitely.

- A v1/v2 operation with no order field replays with legacy `current` semantics.
- A newly issued distribute operation always contains `order` and is written in v3.
- `migrate --dry-run` prints the proposed schema change without rewriting a file.
- No automatic migration occurs merely because a file was rendered or inspected.
- Older clients fail clearly on v3 rather than partially interpreting it.

This is preferable to silently changing the meaning of an existing operation.

## 6. High-level intent without feature breadth

The initial OSS commit adds `row` and `stack`. They are persistent semantic operations, not CLI-only
macros, so MCP and the editor can express the same intent and `history` can explain what the user
asked for.

```ts
interface RowNodes {
  op: "row_nodes";
  nodes: string[];
  gap: number;
  align?: "top" | "center" | "bottom";
}

interface StackNodes {
  op: "stack_nodes";
  nodes: string[];
  gap: number;
  align?: "left" | "center" | "right";
}
```

Semantics:

- node list order is always the rendered order;
- the first node anchors the row's left coordinate or stack's top coordinate;
- the cross-axis default is `center`;
- nodes retain their individual sizes;
- affected edges are rerouted once after the complete operation;
- the operation is pure and center/edge math is tested without a browser;
- duplicate or missing IDs fail the candidate transaction before persistence.

CLI examples:

```bash
straightedge row chart.mmd ingest enrich model database --gap 24
straightedge stack chart.mmd ceo chief lead --gap 24
```

`center ... --over ...` is useful but its group-translation anchor needs a separate, precise
decision. `tree ... --routing org-chart` also requires hierarchy extraction, port selection,
shared branching rails, sibling-order policy, and fallback behavior. Those two commands are
post-initial-commit work and must not be shipped as loose aliases for several nudges.

The eventual org-chart mode must guarantee bottom-to-top hierarchy ports, a shared rail per sibling
group, deterministic sibling order, and no unrelated-node crossings. It will be specified in the
edge-routing follow-up ADR reserved by ADR-0001.

## 7. Sidecar explainability

### 7.1 Replay trace

Replay will optionally produce an in-memory trace for each operation:

```ts
interface ReplayTrace {
  index: number;
  op: Op;
  state: "effective" | "partially_overridden" | "overridden" | "skipped";
  changedNodes: string[];
  changedEdges: string[];
  notes: string[];
}
```

The trace is derived data and is never persisted as a second layout model.

### 7.2 `history`

`straightedge history chart.mmd` prints, in operation order:

- index and semantic operation;
- referenced nodes and edges;
- whether it remains effective, was later overridden, or was skipped;
- stale IDs and the later operation that superseded a property when knowable.

`--json` returns the same trace used by MCP and the editor.

### 7.3 `explain`

`straightedge explain chart.mmd` summarizes:

- Mermaid-declared direction;
- effective row/column ordering;
- active frame, theme, and routing policy;
- operations that materially oppose source direction;
- alignments later broken by moves, distribution, or resize;
- repeated or redundant style/presentation settings;
- the exact active diagnostic profile and what its success claim means.

These are `ExplainFinding` records, not publication-blocking `Problem` records. The tool explains
intent and provenance; it does not invent new state.

### 7.4 Conservative compaction

`compact` is included only if it can prove equivalence. Its default is dry-run.

Allowed initial rewrites are deliberately narrow:

- combine adjacent moves of the same node;
- merge adjacent style operations on the same subject with normal last-key-wins behavior;
- remove an exact duplicate adjacent operation;
- remove a presentation or theme operation immediately superseded by another of the same kind
  before any operation whose measurement depends on it.

Compaction never reorders operations, flattens `row_nodes`/`stack_nodes`, or guesses that two
visually similar layouts carry the same intent.

Before `compact --yes` commits, Straightedge must replay both logs and prove:

- equal node geometry within 0.01 CSS pixels;
- equal edge waypoint geometry within 0.01 CSS pixels;
- equal presentation and theme state;
- identical structured diagnostic kinds, severities, and subjects;
- one atomic compare-and-swap write with a recoverable backup.

If this proof is not implemented before the initial commit, `compact` remains documented
post-commit work. A fake or lossy compactor is worse than a long sidecar.

## 8. Trust-consistent destructive actions

### 8.1 Undo

CLI, MCP, and editor undo use the transaction path:

1. snapshot sidecar bytes;
2. remove the last operation in memory;
3. replay, render, and run the active checks;
4. commit with compare-and-swap only if the candidate can be produced successfully;
5. otherwise retain the original bytes and report the failure.

Undo is allowed to result in `review` or `failed` diagnostics because it restores prior user intent,
but parse/runtime failure never corrupts the log. The response names the removed operation and
sidecar path.

### 8.2 Reset

Bare `straightedge reset chart.mmd` becomes a preview and changes nothing. It prints:

- the exact sidecar path;
- operation count and sidecar version;
- the candidate baseline status;
- the backup path that will be used.

Mutation requires `reset --yes`. By default the sidecar is atomically moved to:

```text
.straightedge/backups/<diagram>/<UTC timestamp>-<short id>.layout.json
```

`reset --yes --no-backup` requires both flags and reports that recovery is unavailable. MCP
`reset_layout` requires `confirm: true`; the editor presents an inline confirmation naming the
file and operation count. All surfaces return the backup path when one exists.

`straightedge restore <backup> --dry-run` previews restoration; `--yes` validates and atomically
restores it. Backup data is recovery material, not active layout state, and `.straightedge/` is
ignored by Git by default.

Named user checkpoints are deferred. The recoverable reset path meets the initial safety bar
without introducing a second long-lived history system.

## 9. Editor hardening

The loopback-only server, unguessable token, selected-file boundary, and shared transaction engine
remain unchanged. Before the initial commit, the editor must add the following behavior.

### Source dirty state

- Any source input marks the Mermaid editor dirty and shows `Unsaved source` visibly.
- A layout action while dirty opens an inline three-choice panel: **Save and apply**, **Discard and
  apply**, or **Cancel**.
- Refresh, navigation, and page close use the same dirty-state guard.
- No render response may overwrite the source textarea while dirty.
- Saving invalid Mermaid retains the draft, displays the parse error inline, and leaves disk bytes
  unchanged.

### Partial resize

- Blank width or height is omitted from the operation rather than converted to zero.
- At least one dimension must be present and positive.
- Editing one dimension of a circle uses the same aspect-preserving resolution as CLI/MCP.
- The UI shows the resolved dimensions before commit when aspect preservation changes both.

### Interaction quality

- selection order is visible as numbered chips and is the exact order passed to row, stack, align,
  and distribute;
- zoom in, zoom out, 100%, and fit-to-screen are viewport-only state and never enter the sidecar;
- `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` drive layout undo/redo when focus is outside the source editor;
- native textarea undo/redo remains scoped to source editing;
- errors and transaction rejection appear inline with their structured evidence—no `alert()`;
- keyboard focus, labels, contrast, and button disabled states pass a basic accessibility audit.

## 10. Repository contents and generated artifacts

### 10.1 Git initialization boundary

Do not run `git init` until the release-blocking files and canonical repository identity are ready.
Immediately before initialization:

- remove `.DS_Store` from the project directory;
- verify no credentials, absolute attachment paths, browser profiles, temporary diagrams, backups,
  or local npm configuration are present;
- verify every tracked file is intentional using an explicit manifest review;
- initialize with `main` as the default branch.

The initial public commit should be reviewable as source, tests, documentation, and OSS policy—not
as a dump of the working directory.

### 10.2 `.gitignore`

The initial `.gitignore` contains at least:

```gitignore
.DS_Store
node_modules/
dist/
coverage/
*.tgz
*.log
.straightedge/
examples/*.png
examples/*.svg
```

README assets under `docs/assets/` are explicit exceptions and are committed.

### 10.3 `dist` policy

`dist` is generated and is not committed to Git. Reasons:

- declarations and source maps are deterministic build outputs;
- reviewing compiled JavaScript duplicates source review;
- stale generated output is a known publication risk;
- npm can build it in `prepack` from a clean checkout.

The npm package includes `dist`, but the Git repository does not. The release pipeline proves the
dist contents were built from the tagged source.

## 11. Legal, ownership, and community files

The initial commit includes:

- the unmodified Apache License 2.0 text in root `LICENSE`;
- a copyright holder/year decision recorded in `NOTICE` only if project or dependency attribution
  requires it;
- `CONTRIBUTING.md` with setup, test, ADR, fixture, and pull-request expectations;
- `CODE_OF_CONDUCT.md` using a named, versioned Contributor Covenant;
- `SECURITY.md` with supported versions, a private reporting channel, expected response window, and
  a warning not to file exploitable path/server issues publicly;
- `CHANGELOG.md` with an Unreleased section and the first public version convention;
- GitHub issue templates for bugs and diagram-quality fixtures, plus a pull-request template.

The canonical owner, repository URL, npm package ownership, security contact, and copyright holder
are release inputs. Placeholders for any of them are release blockers.

## 12. Package contract

### 12.1 Metadata

Before the initial commit, `package.json` includes validated values for:

```json
{
  "types": "./dist/index.d.ts",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<owner>/straightedge.git"
  },
  "homepage": "https://github.com/<owner>/straightedge#readme",
  "bugs": {
    "url": "https://github.com/<owner>/straightedge/issues"
  },
  "keywords": [
    "mermaid",
    "diagram",
    "layout",
    "mcp",
    "model-context-protocol",
    "flowchart"
  ]
}
```

`<owner>` must never remain in the implemented `package.json`, public README, or community files;
its appearance in this ADR is illustrative. The npm name is checked for availability or ownership
before documentation advertises `npm install straightedge`.

### 12.2 Build and pack lifecycle

- `dist` is absent at the beginning of the packaging job.
- `prepack` builds declarations, JavaScript, and source maps.
- `prepublishOnly` runs type-check, unit tests, and browser E2E. Package and consumer smoke tests
  run in CI before publication rather than recursively invoking pack from the npm lifecycle.
- `files` explicitly includes `dist`, `SPEC.md`, and any runtime-required assets. npm's automatic
  README and LICENSE inclusion is still verified in the tarball manifest.
- The CLI executable retains its shebang and executable mode after packing.
- Package size and file-count budgets are recorded in CI. Initial warning budgets are 100 KB
  compressed and 100 files; exceeding them requires explanation, not automatic failure if Mermaid
  packaging behavior legitimately changes.

### 12.3 Consumer smoke test

CI packs the tarball with a job-local npm cache, installs it into a new temporary project, and runs:

```bash
npx straightedge --version
npx straightedge doctor --json
npx straightedge render fixture.mmd
npx straightedge check fixture.mmd --json
node -e "import('straightedge').then(m => { if (!m.render) process.exit(1) })"
```

The test asserts that no source-tree `node_modules`, undeclared file, or absolute local path is
needed at runtime.

The current workstation's root-owned global npm cache is not modified as part of this work. Local
pack verification uses a temporary `npm_config_cache`; CI begins clean.

## 13. README and first-run journey

### 13.1 Visual proof

The README starts with a committed prompt-led sequence generated from sanitized examples. It shows
the default render, semantic layout, styled presentation, and a shape-aware resize beside the exact
metadata changes that produce each result:

```text
docs/assets/pipeline-before.png
docs/assets/pipeline-layout.png
docs/assets/pipeline-after.png
docs/assets/pipeline-after.layout.json
docs/assets/review-gate-before.png
docs/assets/review-gate-after.png
docs/assets/review-gate-after.layout.json
```

Requirements:

- images are legible at GitHub README width and include useful alt text;
- the exact Mermaid source and sidecar needed to regenerate them are committed;
- a documented script or command regenerates the images;
- the “after” image passes the presentation profile used in the caption;
- no claim says the tool certified subjective presentation quality;
- static PNGs are the minimum bar; a GIF may supplement but not replace them.

### 13.2 Separate installation paths

The README has three unambiguous paths.

**Install from npm** appears only after a package is actually available:

```bash
npm install --global straightedge
straightedge render diagram.mmd
```

**Run from source** is the initial-commit golden path:

```bash
git clone https://github.com/<owner>/straightedge.git
cd straightedge
npm ci
npm run build
node dist/cli.js render examples/pipeline.mmd
node dist/cli.js edit examples/pipeline.mmd
```

**Connect as MCP** contains one complete client configuration using the built absolute CLI path,
then lists the inspect → transaction → result loop.

The README also states the supported Node version, supported Mermaid scope, browser requirement,
platforms tested in CI, generated output paths, exit codes, diagnostic profiles, and the safety
behavior of undo/reset.

## 14. Continuous integration

The initial repository includes `.github/workflows/ci.yml` with least-privilege
`contents: read`, explicit timeouts, npm caching, and these jobs:

### Static and unit

- Ubuntu, Node 22;
- `npm ci`;
- `npm run check`;
- `npm test`;
- coverage report, with the existing domain baseline recorded rather than immediately ratcheted
  from an arbitrary number.

### Browser E2E

- Ubuntu, Node 22, using Puppeteer's supported Chromium;
- `npm run test:e2e`;
- editor source-dirty, partial-resize, selection-order, keyboard undo/redo, and inline-error flows;
- deterministic row/stack and safe undo/reset flows;
- upload failing screenshots/logs only, with short retention and no local source contents beyond
  sanitized fixtures.

### Package

- fresh checkout with `dist` absent;
- isolated npm cache;
- `npm pack --dry-run --json` manifest assertion;
- actual tarball pack and clean consumer install;
- CLI, ESM import, doctor, render, and check smoke tests;
- verify README, LICENSE, declarations, and executable CLI are present;
- verify source attachments, `.DS_Store`, backups, test output, and `node_modules` are absent.

Pull requests require all three jobs. A separate publish workflow is not part of the initial commit
unless npm trusted publishing, protected environments, provenance, and owner approval are fully
configured. Publication must never depend on a long-lived token committed to repository settings
without a rotation plan.

## 15. Security and privacy boundary

The initial OSS documentation states:

- the editor binds only to loopback and requires its session token;
- it exposes only the selected Mermaid source and sidecar/recovery paths;
- Mermaid rendering uses the documented security configuration and does not make the editor safe
  for untrusted remote hosting;
- Straightedge has no telemetry and sends no diagram content to a Straightedge service;
- dependency installation and a caller's MCP host may have their own network behavior;
- remote editor exposure, authentication, accounts, and collaboration are unsupported.

Release checks include:

- dependency audit with no unexplained high/critical production vulnerability;
- a package-content scan for secrets, absolute user paths, tokens, and private attachment names;
- tests proving an invalid editor token is rejected and paths outside the selected diagram boundary
  are unavailable;
- review of Mermaid `securityLevel` and any HTML-label behavior as a documented threat-model choice.

## 16. Required test coverage

### Pure/domain tests

- legacy omitted-order behavior remains `current`;
- new given-order distribution is stable under changed baselines and unequal node sizes;
- row/stack ordering, anchor, alignment, missing ID, and duplicate ID behavior;
- replay traces identify skipped, overridden, and effective operations;
- direction-conflict explanation;
- conservative compaction equivalence, if compaction ships;
- reset preview and backup-path construction;
- v1/v2 read and v3 promotion/migration behavior.

### CLI/MCP contract tests

- equivalent row, stack, distribute, undo, reset preview, history, and explain calls return matching
  sidecars and structured results;
- successful human text is “No blocking problems were detected by the active checks”;
- result profile and completed-check list agree across JSON and MCP;
- failed undo leaves original bytes intact;
- reset without confirmation changes nothing;
- reset with backup is restorable;
- all mutation output names the changed file and exact committed operations.

### Browser E2E

- typing unsaved Mermaid followed by resize, drag, align, repair, refresh, and close each triggers the
  dirty-state guard and never replaces the draft silently;
- blank width or height is omitted and single-dimension circle resize preserves aspect ratio;
- numbered selection order drives the resulting operation;
- zoom and fit do not alter source or sidecar;
- keyboard source undo and layout undo remain separate;
- errors render inline and no expected flow uses `alert()`;
- full fresh editor edit → undo → redo → restart journey replays identically.

### Packaging and documentation

- golden path commands execute from a clean checkout;
- README image regeneration is deterministic enough to preserve declared dimensions and checked
  diagnostics; pixel identity across platforms is not required;
- tarball installs into a clean consumer project;
- published entry point declarations resolve under TypeScript `NodeNext`;
- license and policy links resolve.

## 17. Initial public commit gate

The initial commit is allowed only when every P0 gate is evidenced:

| Gate | Required evidence |
|---|---|
| Identity | Canonical GitHub owner/repository, npm-name decision, security contact, and copyright holder contain no placeholders |
| Hygiene | `.gitignore` exists; `.DS_Store`, `node_modules`, `dist`, backups, credentials, and generated example output are absent from the tracked manifest |
| Legal/community | LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, issue templates, and PR template are present |
| Honest claims | No UI says visually clean or presentation-ready; result reports active profile and completed checks |
| Determinism | Given-order distribution plus row/stack pass unit, CLI/MCP, replay, and changed-baseline tests |
| Explainability | History and explain expose effective, overridden, stale, and direction-conflicting intent |
| Safety | Atomic undo, reset preview/confirmation, recoverable backup, and restore pass byte-preservation tests |
| Editor | Dirty state, partial resize, selection order, zoom/fit, keyboard undo/redo, and inline errors pass browser E2E |
| Visual README | Before/after assets are committed, legible, reproducible, and backed by the sanitized example |
| CI | Static/unit, browser, and package jobs pass from a fresh checkout on the public default branch |
| Package | Dry-run manifest and installed-tarball smoke pass with declarations, CLI, README, and LICENSE present |
| Security | Loopback/token/path tests pass and no unexplained high/critical production advisory remains |

The final manual acceptance transcript is:

```text
fresh clone
  -> npm ci
  -> npm run test:all
  -> render examples/pipeline.mmd
  -> open the editor
  -> edit and save Mermaid
  -> row/resize/drag a node
  -> undo safely and redo
  -> inspect history and explain
  -> preview reset; reset with backup; restore
  -> pack and install the tarball in an empty project
  -> run doctor, render, check, and the ESM import from the installed artifact
```

No release gate depends on an uncommitted local file or a developer's pre-existing browser/cache
state.

## 18. Delivery sequence

Implement in this order so later work is tested on the actual public contract:

1. **Language and result scope:** honest human copy, profile/check summary, documentation terms.
2. **Determinism and schema:** v3 migration, explicit distribute ordering, row/stack, replay tests.
3. **Explainability and safety:** replay trace, history, explain, atomic undo, reset/restore.
4. **Editor hardening:** dirty guard, partial resize, selection order, zoom/fit, shortcuts, inline
   errors.
5. **Repository/legal identity:** ignore policy, license/community files, canonical metadata.
6. **First-run proof:** sanitized example, reproducible before/after assets, separated README paths.
7. **CI and package:** clean jobs, isolated pack, installed-consumer smoke, security/content scan.
8. **Manifest review and Git initialization:** initialize only after all P0 evidence is recorded.

The first npm action should be a prerelease such as `0.2.0-alpha.1` after the public commit and CI
pass. Promote to `0.2.0` only after installing that exact prerelease tarball and completing the
golden journey on at least macOS and CI Linux. Do not reuse an already-published version.

## 19. Explicitly deferred work

The following do not block the initial public commit:

- `center ... --over ...` until group anchoring semantics are specified;
- `tree ... --routing org-chart` and sibling rail/port diagnostics;
- named checkpoints beyond reset backups;
- aggressive sidecar squash or canonical minimal-log generation;
- Windows certification unless the browser and editor suites are run there;
- pixel-perfect cross-platform images;
- a hosted editor, accounts, telemetry, cloud storage, or remote collaboration;
- subgraphs and any Mermaid type beyond supported flowcharts;
- automatic aesthetic scoring or a claim that Straightedge can certify good design.

Deferred work must appear in the README as a limitation only when users could reasonably infer it
is supported. It must not be represented by a stub command.

## 20. Alternatives considered

### Publish the current directory immediately

Rejected. The engine is useful, but the repository and first-run contract are not yet a credible
OSS artifact. Generated dependencies, missing license/CI, ambiguous success copy, and irreversible
commands would make the first public experience weaker than the core.

### Commit `dist`

Rejected. npm needs built artifacts; Git review does not. A clean `prepack` and consumer smoke test
give stronger provenance than checked-in compiled output.

### Change all old distribute operations to argument order

Rejected. Existing sidecars were authored under current-position semantics. Silent reinterpretation
would violate the replay promise. Old omission remains legacy `current`; new calls persist their
choice explicitly.

### Make presentation heuristics blocking

Rejected. Long connectors, whitespace, and hierarchy symmetry contain aesthetic judgment and will
produce false positives while the corpus is small. They begin as evidenced warnings in an explicit
profile.

### Ship every proposed semantic command before opening the repository

Rejected. Row and stack solve deterministic common intent with small, pure semantics. Group
centering and org-chart routing require deeper decisions and would delay feedback on the already
valuable core.

### Store editor drafts or history as another layout database

Rejected. Dirty source remains in the browser until explicitly saved; operation history is derived
from the sidecar; recovery files are backups, not an active competing model.

### Require no confirmation because the sidecar is disposable

Rejected. The file may be mechanically disposable, but it represents hours of user intent. Trust
is about the cost to the user, not the replaceability of the file format.

## 21. Consequences

### Positive

- The initial public claim is precise and defensible.
- Explicit order closes a surprising determinism gap without breaking old replay.
- High-level row/stack intent remains readable and cross-surface.
- New users can see value before reading architecture and can reproduce the demonstration.
- Destructive paths meet the same transaction standard as constructive edits.
- The npm artifact is proven from a clean source checkout.
- Contributors receive clear legal, security, test, fixture, and decision-making guidance.

### Costs

- Sidecar v3 and replay tracing add migration and contract-test surface.
- Browser E2E grows and CI becomes slower.
- Recovery backups require lifecycle documentation and an ignored local directory.
- Presentation warnings need corpus tuning and suppression semantics.
- The initial public commit is delayed until repository identity and policy inputs are decided.

### Risk controls

- Keep subjective findings advisory.
- Preserve old sidecar semantics and promote only on a new operation.
- Keep compaction dry-run unless equivalence is proven.
- Keep org-chart routing out of the release blocker.
- Record every public command and JSON/MCP field in contract tests.
- Treat a flaky browser test as a defect to isolate, not a reason to remove the browser gate.

## 22. Success criterion

This ADR succeeds when someone with no Straightedge state can clone the public repository, follow
the README without inference, see why the product exists, make an ordered visual edit, understand
the resulting sidecar, reverse the edit without data loss, and install the packed artifact—while
Straightedge describes exactly what it checked and never mistakes mechanical validity for design
judgment.

## 23. Implementation record

The decision was implemented on the `ADR0007` branch created from baseline commit `ed2a662` and
reviewed in the public repository. The user's requested Git sequence intentionally preceded the
public-release gate described in section 10; the branch and its hosted checks preserve that
reviewable boundary.

Local acceptance evidence on 2026-08-12:

- `npm run test:all` covers type-checking, 34 unit/domain tests, 10 browser/CLI/MCP/editor E2E tests,
  documentation verification, and an installed-tarball consumer smoke;
- `npm run test:coverage` records a 66.78% line, 78.13% branch, and 70.33% function baseline across
  the source modules without imposing an arbitrary release threshold;
- isolated pack/install verification produces `straightedge-0.2.0-alpha.1.tgz` at 88,527
  compressed bytes across 70 files, with executable CLI, declarations, README, and LICENSE;
- the installed consumer runs version, doctor, render, check, ESM import, and TypeScript NodeNext
  declaration resolution without the source checkout or nested dependency layout;
- `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities after deliberately moving
  the pinned Mermaid integration from 11.4.1 to 11.16.1 and Puppeteer from 23.x to 25.6.0, then
  rerunning every browser baseline;
- the npm registry returned `E404` for `straightedge` on this date, so the prerelease name is not
  currently visible as published; ownership still must be established by the actual publish;
- a visible local-browser pass confirmed full-canvas Fit, disabled control state, inline
  presentation advisories, and the save/discard/cancel dirty-source guard without changing source
  or sidecar bytes; and
- manifest review shows `dist`, `node_modules`, coverage, example render output, backups, package
  archives, logs, and `.DS_Store` are ignored and absent from the intended commit.

GitHub private vulnerability reporting is enabled, so the concrete URL in `SECURITY.md` is live.
No npm publication is authorized by this ADR or by the implementation work.
