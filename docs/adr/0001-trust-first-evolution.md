# ADR-0001: Trust-first evolution of Straightedge

- **Status:** Accepted; v0.2 implementation complete
- **Date:** 2026-08-11
- **Decision scope:** v0.2 through v1.0 product and architecture direction
- **Supersedes:** None
- **Related:** `SPEC.md` (v0.1 architecture and constraints)

**Implementation note:** v0.2 ships the trust foundation plus the first presentation and
co-editing slices described here: frames, themes, obstacle-aware rerouting, and the loopback editor.
Advanced routing lanes/bundling, custom theme packs, subgraphs, and additional Mermaid families
remain gated follow-up work rather than being pulled into the trusted flowchart core prematurely.

## 1. Decision

Straightedge will remain focused on Mermaid flowcharts until its editing and checking loop is
trustworthy enough that a clean result is safe to publish in a deck, document, README, or
architecture review.

We will invest in the following order:

1. **Trust:** browser-derived visual diagnostics, label reflow, structured problems and repairs,
   transactional mutations, CLI/MCP parity, runtime diagnostics, and a unified result envelope.
2. **Presentation:** persistent target frames, fit policies, export controls, a small theme system,
   and obstacle-aware edge routing.
3. **Co-editing:** a small local editor that writes the same semantic operations as the CLI and MCP
   tools.
4. **Breadth:** subgraphs, more Mermaid diagram types, and a stable extension ecosystem only after
   the flowchart quality gates in this ADR are met.

Straightedge will not become a second diagram language or a general drawing application. Ordinary
Mermaid remains the semantic source of truth. Replayable operations remain the source of visual
intent. Automated QA becomes the publication contract.

## 2. Why this decision is necessary

Repeated use in a real presentation deck validated the core product idea and exposed the next
constraint.

The strongest product moment was `check` identifying edges that crossed intermediate nodes. That
feedback allowed an agent to recognize a concrete defect and correct it without making the human
act as the visual debugger. This is Straightedge's differentiator.

The same usage also showed that the current statement “layout looks clean” is too weak:

- labels can be clipped or touch their shape boundary without a reported problem;
- a resized outline can disagree with the label's measured viewport;
- a diagram can have no overlaps and still be unusably wide for its destination slide;
- the CLI cannot express the mutations available through MCP;
- every operation incurs another Chromium lifecycle;
- browser-launch failures are not diagnosed as actionable runtime problems;
- repeated styling is verbose;
- re-anchored edges can still take visually poor routes.

Adding more Mermaid diagram types now would multiply these failure modes. It would increase surface
area without improving the reason to choose Straightedge.

## 3. Current architecture baseline

v0.1 has a deliberately small pipeline:

```text
.mmd source
  -> Mermaid parse and browser measurement
  -> ELK baseline
  -> replay <name>.layout.json operations
  -> re-anchor touched edges
  -> normalize to bounding-box canvas
  -> geometry lint
  -> Mermaid paint in Chromium
  -> SVG + PNG
```

The current sidecar contains only `{ version: 1, ops: [...] }`. Geometry lint reports overlaps,
near-collisions, and edges crossing nodes. Mutation tools append one operation before rendering.
The CLI supports render, inspect, check, reset, and MCP startup. Chromium is launched separately
for measurement and paint.

The recent shape-aware resize fix fits a rendered outline to requested dimensions. That is useful,
but it intentionally leaves text unscaled. It therefore makes browser-derived label checks more
urgent: a smaller shape can now expose label overflow that geometry alone cannot see.

## 4. Decision drivers

In priority order:

1. A user must be able to trust the word **clean**.
2. An agent must receive evidence and an actionable next step, not only prose warnings.
3. A visual edit must have the same meaning through MCP, CLI, batch automation, and the editor.
4. Presentation output must honor a known destination without silently destroying readability.
5. Mutations must be atomic when several operations represent one user request.
6. The system must retain ordinary Mermaid and readable semantic operations.
7. Interactive latency and browser failures must not dominate the conversation.
8. New breadth must be gated by evidence from the supported flowchart corpus.

## 5. Product invariants

These invariants remain binding through v1.0:

- The `.mmd` file is valid ordinary Mermaid and does not contain Straightedge-only coordinates.
- Node IDs remain layout identity; labels may change independently.
- Visual intent is persisted as readable semantic operations, not resolved coordinates.
- All operation application is deterministic and pure once source measurement is available.
- The UI, CLI, and MCP layer use one transaction and replay engine.
- No surface stores private GUI coordinates or a second hidden layout model.
- A repair never commits silently. The caller receives the proposed and applied operations.
- If a target frame cannot be satisfied above its minimum font size, Straightedge fails explicitly.
- Unsupported Mermaid constructs are rejected rather than rendered approximately.
- Named MCP tools remain available; a generic operation envelope will not become the only interface.

### 5.1 Reference conversational journey

The implementation must preserve this user journey across MCP, CLI automation, and the local
editor:

1. The user opens or names an ordinary Mermaid flowchart and, optionally, a destination such as
   `slides-16:9`.
2. Straightedge renders and inspects the diagram before mutation, returning the image, measured
   geometry, target-frame status, and structured problems.
3. The user gives a visual instruction in ordinary language, for example:
   - “align box A and box B”;
   - “add more space between Charlie and Foxtrot”;
   - “make box A wider”; or
   - “make circle Y about 10% smaller.”
4. The agent resolves names to stable node IDs, translates the request into one or more semantic
   operations, and submits them as one transaction. Ambiguous axes, subjects, or units are reported
   before commit rather than guessed when the alternatives would materially differ.
5. Straightedge applies the operations in memory, remeasures affected labels and shapes, routes
   affected edges, renders once, and runs the active diagnostic profile.
6. If the candidate is publishable, the transaction commits. If a safe mechanical repair is
   available, Straightedge returns a preview or applies it only when the caller explicitly enabled
   guarded repair. Otherwise it rolls back and explains the blocking problem.
7. The user receives the updated image plus a concise account of what changed, the exact committed
   operations, any remaining review items, and whether the target frame is satisfied.
8. The next instruction starts from that committed state, so the human and agent can continue the
   same back-and-forth without restating prior visual intent.

The agent owns language interpretation; Straightedge owns deterministic visual semantics and
verification. “About 10% smaller” becomes a resolved percentage-based resize request against the
current measured shape, while the committed log records stable resolved dimensions so replay does
not compound the percentage after a new baseline layout.

The canonical end-to-end acceptance scenario is a deck-bound flowchart that receives, in separate
turns, alignment, spacing, shape-aware resizing, and frame-fit requests. After every turn, a restart
and replay must reproduce the same visual state and diagnostics.

## 6. The new definition of “clean”

`clean` will mean that no active diagnostic profile reports an error or warning after the final
export geometry is known.

The result contract will distinguish three states:

| Status | Meaning | Default CLI exit |
|---|---|---|
| `clean` | No errors or warnings in the active profile | `0` |
| `review` | No errors, but one or more warnings need human/agent judgment | `1` |
| `failed` | At least one publication-blocking error or a runtime/input failure | `2` |

“Layout looks clean” must never be emitted when the browser-derived visual checks were skipped or
failed. In that case the result is `failed` with a diagnostic explaining which stage was
unavailable.

### 6.1 Structured problem model

The existing `LintProblem` will evolve into a public, versioned `Problem` shape:

```ts
interface Problem {
  id: string;
  kind: ProblemKind;
  severity: "error" | "warning" | "info";
  message: string;
  subjects: {
    nodes?: string[];
    edges?: string[];
  };
  evidence: Record<string, string | number | boolean>;
  suggestedOps: Op[];
  safeToAutoApply: boolean;
}
```

Example:

```json
{
  "id": "text_overflow:transition_ready",
  "kind": "text_overflow",
  "severity": "error",
  "message": "Label in transition_ready overflows the right edge by 14px",
  "subjects": { "nodes": ["transition_ready"] },
  "evidence": {
    "overflowRightPx": 14,
    "labelWidthPx": 254,
    "availableWidthPx": 240
  },
  "suggestedOps": [
    {
      "op": "resize_node",
      "node": "transition_ready",
      "width": 286
    }
  ],
  "safeToAutoApply": true
}
```

Stable problem IDs let an editor retain selection and let tests compare diagnostics without
depending on prose.

### 6.2 Diagnostic layers

Diagnostics will be split by what they can truthfully observe:

1. **Geometry diagnostics (pure):** overlap, near-collision, edge/node intersection, nodes outside
   the target frame, insufficient spacing, and invalid or stale operations.
2. **Visual DOM diagnostics (Chromium):** label overflow, label-to-boundary padding, wrapping,
   actual font size, edge-label collision, arrowhead obstruction, and rendered shape bounds.
3. **Export diagnostics:** final scaled font size, SVG-safe margin, target-frame containment,
   background behavior, and raster dimensions/DPI.

The visual layer will measure the final SVG DOM using bounding boxes and computed styles. Screenshot
pixel analysis will not be the primary checker because it is slower and less explainable.

### 6.3 Required v0.2 problem kinds

- `text_overflow`
- `text_touches_boundary`
- `font_below_minimum`
- `node_outside_frame`
- `edge_label_collision`
- `arrowhead_obscured`
- `inconsistent_padding`
- `wrap_policy_violation`
- the existing `overlap`, `near_collision`, and `edge_crosses_node`

The first implementation may classify inconsistent padding as a warning. Text overflow, obscured
arrowheads, and any content outside an active target frame are errors.

## 7. Label layout and shape-aware resizing

Resizing must operate on a node as a composition of outline, label viewport, padding, and shape
geometry.

The paint stage will stop treating outline fitting as sufficient. Before final paint it will:

1. measure the label at the active typography and wrapping width;
2. calculate the shape's minimum intrinsic width and height from label bounds plus theme padding;
3. wrap or reflow according to the active policy;
4. fit the shape outline to the resolved node bounds;
5. measure the final label and outline in Chromium;
6. emit a structured error if an explicit requested size is smaller than the supported intrinsic
   size.

Straightedge will not silently scale label text to make an undersized node appear valid. Font size
may change only through an explicit style/theme operation or presentation fit policy that still
respects the configured minimum.

For a request such as “make circle Y 10% smaller,” the agent will inspect the measured diameter,
calculate 90%, and submit both width and height. If the label cannot fit at that diameter, the
result will contain a suggested minimum diameter instead of clipping.

## 8. Repair as a guarded transaction

`straightedge repair` and the corresponding MCP capability will apply only suggestions marked
`safeToAutoApply`.

The repair loop is:

```text
render + diagnose
  -> select non-conflicting safe suggestions
  -> apply in memory
  -> render + diagnose again
  -> commit only if severity strictly improves and no new error appears
```

Rules:

- Default maximum: three repair passes.
- Suggestions affecting the same node or edge conflict unless explicitly composable.
- Every pass returns its candidate operations and before/after problems.
- A failed or non-improving pass is discarded.
- Source and sidecar files remain byte-for-byte unchanged until commit.
- Repairs that alter meaning, remove content, reduce font below the minimum, or move a manually
  pinned node are never automatically safe.

Initial safe repairs are deliberately narrow: grow a node to its measured minimum, move a node
inside frame padding, increase a gap to the configured minimum, and rewrap a label at an already
approved width.

## 9. Presentation-aware render state

Presentation requirements must be persistent and replayable because the destination frame is part
of visual intent.

### 9.1 Sidecar v2

The sidecar will move to version 2 when presentation or theme operations are introduced:

```json
{
  "version": 2,
  "ops": [
    {
      "op": "set_presentation",
      "preset": "slide-16x9",
      "frame": { "width": 1188, "height": 420 },
      "padding": 32,
      "minFontSize": 18,
      "background": "transparent",
      "rasterScale": 2,
      "overflowPolicy": "prefer_rows"
    },
    { "op": "apply_theme", "theme": "executive-light" }
  ]
}
```

Operations will replay over a `DiagramState` containing layout, presentation policy, theme, and
export intent. This preserves one model and keeps undo/redo chronological.

Version 1 logs will load through a deterministic in-memory migration. They will not be rewritten
until the next successful mutation. Version 2 writes will be validated against a strict schema and
written canonically. v0.1 tools must fail clearly on v2 rather than partially applying unknown
operations.

### 9.2 Initial presets

Ship a small, tested set:

- `slide-16x9`
- `google-slides-16x9`
- `a4-portrait`
- `a4-landscape`
- `readme-wide`

A preset provides defaults. Explicit frame dimensions override preset dimensions. Presets are data,
not code plugins.

### 9.3 Fit policy

To satisfy a target frame, Straightedge will try these actions in order:

1. apply the theme's wrapping and padding;
2. resize nodes to measured intrinsic sizes;
3. adjust distribution and gaps within configured bounds;
4. reflow layers or rows when the policy allows it;
5. reroute affected edges;
6. scale the diagram only while the final font remains at or above `minFontSize`;
7. fail with suggestions when the frame still cannot be satisfied.

`prefer_rows` means that a second row is preferred over reducing typography. It does not authorize
arbitrary semantic reordering. Any structural change appears in the returned changed operations.

### 9.4 Export controls

Presentation mode will support:

- fixed frame width and height or aspect ratio;
- transparent or explicit canvas background;
- PNG raster scale and DPI metadata;
- SVG-safe margins;
- exact output dimensions;
- minimum rendered font size;
- explicit failure when export constraints conflict.

## 10. CLI parity and transactions

All named MCP mutations will have equivalent CLI commands:

```bash
straightedge move diagram.mmd db --dx 24 --dy 0
straightedge resize diagram.mmd api --width 220
straightedge align diagram.mmd api worker queue --edge centerY
straightedge distribute diagram.mmd api worker queue --axis horizontal --gap 64
straightedge equalize diagram.mmd api worker queue --dimension width
straightedge place diagram.mmd db --below worker --gap 64
straightedge style diagram.mmd critical --theme-role critical
straightedge theme diagram.mmd executive-light
straightedge fit diagram.mmd --preset slide-16x9 --frame 1188x420 --min-font 18
straightedge repair diagram.mmd
straightedge doctor
```

Every command uses the same schema, transaction function, render result, and error semantics as its
MCP counterpart.

### 10.1 Batch application

```bash
straightedge apply diagram.mmd ops.json \
  --render \
  --check \
  --rollback-on-error
```

The batch engine will:

1. read and validate the original source and sidecar;
2. validate every operation before applying any;
3. apply the batch in memory in the given order;
4. measure, render, and check using one browser session;
5. atomically write a temporary sidecar and rename it only when policy passes;
6. return the exact applied operations, result image, problems, and timings.

`--rollback-on-error` is the default for a batch. `--allow-review` may commit a `review` result but
never a `failed` result. Concurrent writers will use a narrowly scoped lock around the final
compare-and-swap/write step; a stale writer fails instead of losing another session's operations.

Single-operation MCP and CLI mutations will call this transaction engine with a one-item batch.
This removes the current append-before-render failure mode.

## 11. Unified CLI and agent result

All render, check, mutation, repair, and batch paths will produce the same internal result:

```ts
interface StraightedgeResult {
  status: "clean" | "review" | "failed";
  publishable: boolean;
  layout: Layout;
  frame?: FrameResult;
  problems: Problem[];
  warnings: string[];
  appliedOps: Op[];
  changedOps: Op[];
  suggestedOps: Op[];
  svg?: string;
  png?: Buffer;
  timings: Record<string, number>;
}
```

CLI commands support `--json` and keep human-readable output on stderr when emitting files. MCP
returns the image as content and the remaining result as `structuredContent`.

Named mutation tools remain the discoverable vocabulary. Add one `apply_transaction` tool for a
coherent multi-operation request and one `repair` tool for guarded fixes. Do not replace the named
tools with `apply_op({ json })`.

The preferred agent loop becomes:

```text
inspect
  -> apply_transaction
  -> render and full check in the same browser session
  -> return image + geometry + problems + suggested repairs + frame status
```

## 12. Themes and group styling

Themes will be small, curated, and token-based. The first release will contain no more than three
high-quality themes, including `executive-light`.

Theme tokens cover:

- font family, size, weight, and line height;
- label wrapping and node padding;
- node fill, stroke, radius, and semantic role colors;
- edge weight, color, and arrowheads;
- canvas background;
- light/dark contrast requirements.

New operations:

```json
{ "op": "apply_theme", "theme": "executive-light" }
```

```json
{
  "op": "style_nodes",
  "nodes": ["incubation", "transition_ready"],
  "role": "positive"
}
```

`style_nodes` begins with explicit node IDs. We will not introduce a CSS-like selector language in
v0.3; it would make replay more fragile and add a second semantics system. Direct node overrides
win over semantic roles, which win over theme defaults.

Themes are versioned with Straightedge. Custom theme packs are deferred until v1.0 and require a
separate ADR.

## 13. Edge routing

The current straight-line re-anchor remains a fallback, not the presentation router.

The v0.3 routing sequence is:

1. preserve final node positions and sizes from replay;
2. ask ELK to route edges with those node bounds treated as fixed constraints;
3. use orthogonal obstacle avoidance for touched edges;
4. validate routes with geometry and visual diagnostics;
5. fall back to the current clipped straight segment only with a warning.

Add replayable operations only after the constrained-ELK spike proves viable:

```json
{ "op": "reroute_edges", "edges": ["model_to_db"] }
```

```json
{
  "op": "set_edge_waypoints",
  "edge": "model_to_db",
  "points": [
    { "relativeTo": "model", "dx": 40, "dy": 0 },
    { "relativeTo": "db", "dx": 0, "dy": -40 }
  ]
}
```

Waypoints must be relative to stable node identity rather than absolute canvas coordinates.
Routing lanes and bundling are experiments behind v0.3 acceptance data, not initial commitments.

## 14. Runtime and installation

`straightedge doctor` will return both human-readable output and `--json` data for:

- Node version and compatibility;
- resolved Chromium executable and launch result;
- sandbox restrictions and actionable launch flags;
- font availability and measured fallback fonts;
- source, sidecar, and output path writability;
- Mermaid, ELK, Puppeteer, and Straightedge versions;
- a successful parse, measure, render, visual check, and export smoke test;
- per-stage timings.

Browser errors must name the attempted executable and provide a specific next action. Raw spawn
codes without context are not an acceptable user-facing result.

The render runtime will own a reusable browser session:

- CLI single renders reuse one browser for measurement and paint.
- `apply`, `repair`, and `fit` use one browser for all passes in a transaction.
- MCP and the editor use a bounded browser/page pool with idle shutdown.
- Browser crashes invalidate the current transaction and may be retried once from its in-memory
  state; they never partially commit an operation log.

No remote daemon is required. A local persistent daemon is optional after measurements show that
the MCP process lifecycle cannot provide acceptable latency.

## 15. Tiny local editor

The v0.4 editor is a local co-editing surface, not a drawing program.

```text
+----------------------+--------------------------+----------------------+
| Mermaid source       | Rendered canvas          | Operations & checks  |
|                      |                          |                      |
| editable text        | select / drag / resize   | history              |
| parse status         | warning highlights       | problems + repairs   |
+----------------------+--------------------------+----------------------+
```

Required behavior:

- source edits save ordinary `.mmd` and trigger a fresh baseline plus replay;
- dragging records a relative `move_node` operation;
- resizing records `resize_node` with resolved dimensions;
- multi-select exposes align, distribute, equalize, style, and reroute;
- warning selection highlights the exact nodes, edges, label, or frame boundary;
- undo pops the semantic log; redo is session-scoped until a new mutation;
- source-editor undo remains separate from layout-operation undo;
- all commits go through the same transaction API as CLI and MCP;
- the UI never writes resolved coordinates as persistent state.

Launch with `straightedge edit diagram.mmd`. The server binds to loopback only, uses an unguessable
session token, and exposes only the selected source and sidecar paths. Remote collaboration,
accounts, cloud storage, freehand drawing, connectors, arbitrary SVG editing, and infinite canvas
are non-goals.

## 16. Phased delivery plan

### v0.2 — Trust

Deliver in this order:

1. `Problem`, `StraightedgeResult`, JSON schema, and exit-code contract.
2. Browser-derived label/shape measurements and full visual diagnostics.
3. Label wrapping, intrinsic minimum sizes, and structured suggested repairs.
4. In-memory transaction engine and atomic sidecar writes.
5. CLI mutation parity and `apply`.
6. Guarded `repair`.
7. `doctor` and actionable Chromium diagnostics.
8. One-browser-per-transaction runtime and MCP `structuredContent`.

Exit criteria:

- every known clipped-label fixture fails `check` before repair;
- every supported safe repair removes the defect without introducing a new error;
- “clean” is impossible when the visual inspection stage did not run;
- every MCP mutation has a CLI equivalent and shares one transaction test corpus;
- a failed batch leaves source and sidecar byte-identical;
- the deck-derived flowchart corpus has no false-clean result;
- warm transaction timings are reported and browser startup occurs no more than once.

### v0.3 — Presentation

Deliver:

1. sidecar v2 migration and `DiagramState` replay;
2. target frames, presets, and fit policy;
3. export controls and frame diagnostics;
4. `executive-light` plus at most two additional curated themes;
5. `style_nodes` and `apply_theme`;
6. constrained ELK routing, orthogonal obstacle avoidance, and reroute diagnostics;
7. replayable relative waypoints if routing evidence requires them.

Exit criteria:

- every preset produces exact declared output dimensions;
- no successful fit violates minimum font size or frame padding;
- impossible fits fail with actionable suggested operations;
- v1 sidecars migrate deterministically and render equivalently before new v2 operations;
- touched edges avoid unrelated nodes in the presentation regression corpus;
- SVG and PNG export pass the same frame and readability checks.

### v0.4 — Co-editing

Deliver:

1. local editor shell and source save/reparse;
2. selection, drag, resize, and multi-select semantic tools;
3. operation history, undo/redo, and transaction status;
4. warning highlights and repair previews;
5. live MCP/editor file coordination and concurrency protection.

Exit criteria:

- every visual manipulation emits a readable operation already accepted by CLI/MCP;
- no editor-only geometry exists after restart;
- concurrent editor/MCP writes are rejected or serialized without losing operations;
- source edits with stale node IDs surface warnings while unaffected operations replay;
- browser E2E tests cover the complete source-edit, drag, check, undo, and restart journey.

### v1.0 — Ecosystem and breadth

Only after v0.2–v0.4 gates remain green on a representative corpus:

- subgraphs and clusters;
- selected additional Mermaid diagram types based on real demand;
- a stable theme/layout pack interface;
- GitHub Action and CI reporting;
- reusable, versioned presentation packs;
- compatibility and migration guarantees.

## 17. Test strategy

The test pyramid will remain intentional:

### Pure tests

- operation semantics and order;
- v1-to-v2 migration;
- target-frame math and fit-policy decisions;
- problem suggestion generation;
- transaction conflict detection and atomic commit rules;
- theme precedence;
- waypoint replay.

### Browser E2E tests

- label overflow and wrapping using actual DOM measurements;
- text-to-boundary padding for every supported flowchart shape;
- minimum font size after export scaling;
- shape-aware resize with unscaled labels;
- edge-label and arrowhead collision;
- exact frame dimensions, backgrounds, raster scale, and SVG margins;
- one-browser transaction behavior;
- Chromium launch diagnostics.

Tests will assert DOM geometry and structured diagnostics rather than relying primarily on
cross-machine pixel snapshots. A small screenshot gallery is still useful for human release review.

### Contract tests

- every named CLI and MCP mutation produces the same sidecar and result envelope;
- a batch performs one commit and one final render;
- rollback preserves original bytes;
- JSON output validates against the published schema;
- MCP image content and structured content describe the same render.

### Regression corpus

Deck-derived diagrams become sanitized fixtures with their original failure mode, target frame,
expected diagnostic kinds, and publishability outcome. Each real false-clean report adds a fixture
before it is fixed.

## 18. Quality gates before diagram breadth

Support for a new Mermaid diagram family requires all of the following:

- the flowchart regression corpus has zero known false-clean cases;
- every supported shape has label overflow, padding, resize, and edge-anchor E2E coverage;
- presentation presets and minimum-font enforcement pass in SVG and PNG;
- transaction rollback and runtime diagnostics pass on supported platforms;
- the editor produces no private state outside Mermaid and the sidecar;
- the proposed family has at least ten representative real-world fixtures and a named owner for
  its measurement, paint, diagnostic, and migration behavior;
- a dedicated ADR explains what semantics can be shared and what must remain diagram-specific.

## 19. Alternatives considered

### Broaden Mermaid support immediately

Rejected. It multiplies measurement, shape, routing, and diagnostic cases before the clean contract
is reliable.

### Build a full visual drawing application

Rejected. It would compete with Mermaid, introduce persistent coordinates, and split the source of
truth.

### Store final coordinates for presentation mode

Rejected. They become stale after source edits and lose the semantic intent that makes replay
valuable.

### Auto-shrink everything until it fits

Rejected. It can produce technically contained but unreadable output. Minimum font size and
explicit failure are required.

### Make auto-repair unconditional

Rejected. Repairs can conflict, make a diagram worse, or hide a semantic mistake. Repair must be
transactional, evidence-backed, bounded, and inspectable.

### Add a generic selector or styling DSL

Rejected for v0.3. Explicit node IDs and a small semantic-role vocabulary are more durable and
agent-friendly.

### Replace named MCP tools with one batch envelope

Rejected. Named tools teach agents the editing vocabulary. A batch tool supplements them for
coherent transactions.

### Create a separate editor state file

Rejected. The editor must exercise the same Mermaid source and semantic operation log as every
other surface.

## 20. Consequences

### Positive

- “Clean” becomes a meaningful, testable publication promise.
- Deck and document workflows become first-class without making a separate product.
- CLI users and automation receive the same capabilities as agents.
- Batching lowers latency and eliminates partial multi-operation edits.
- The editor reinforces the semantic log instead of bypassing it.
- Real failures become durable regression fixtures and structured repair knowledge.

### Costs

- Chromium moves from an output mechanism to part of the correctness boundary.
- The v0.1 global line budget and single-file type constraint cannot survive the required reporting,
  presentation, transaction, and runtime domains.
- Sidecar v2 requires migration and explicit compatibility behavior.
- Frame fitting and constrained routing introduce solver-like behavior that must remain bounded and
  observable.
- Font availability remains a source of cross-machine differences until themes ship embedded or
  explicitly provisioned fonts.

### Constraint changes from v0.1

Retire the global `~1,200` source-line target at v0.2. Replace it with:

- small modules with a single purpose;
- no abstraction with only one foreseeable implementation;
- a reviewed runtime dependency budget;
- pure geometry/policy cores surrounded by explicit browser and I/O boundaries;
- schema-backed public data contracts;
- `// LIMITATION:` comments for deliberate quality gaps.

Keep core geometry and operation types compact. Move diagnostics, presentation, transactions, and
runtime reporting into their own modules rather than expanding one universal `types.ts`.

## 21. Implementation map

Expected modules after v0.3:

| Module | Responsibility |
|---|---|
| `types.ts` | Core geometry and operation vocabulary |
| `schema.ts` | Sidecar and result JSON validation/migration |
| `diagnostics.ts` | Pure geometry and policy diagnostics |
| `visual-check.ts` | Browser DOM measurements and visual problems |
| `repair.ts` | Suggested-operation selection and bounded repair loop |
| `transaction.ts` | In-memory apply, compare, atomic commit, and rollback |
| `presentation.ts` | Frame presets, fit policy, and export constraints |
| `themes.ts` | Built-in theme tokens and precedence |
| `router.ts` | Constrained ELK routing and waypoint replay |
| `browser.ts` | Browser discovery, pooling, lifecycle, and timings |
| `doctor.ts` | Runtime diagnostics and smoke render |
| `render.ts` | Readable orchestration across the stages above |
| `cli.ts` | Named commands delegating to shared transactions |
| `mcp.ts` | Named tools and structured result translation |
| `editor/` | Local v0.4 server and UI, with no domain logic duplication |

The planned pipeline becomes:

```text
parse + browser measure
  -> baseline
  -> migrate/load DiagramState
  -> replay semantic operations
  -> route
  -> apply presentation fit policy
  -> geometry diagnostics
  -> browser paint
  -> visual/export diagnostics
  -> optional bounded repair transaction
  -> atomic commit
  -> SVG/PNG + structured result
```

## 22. Required follow-up ADRs

This umbrella decision authorizes planning, not unchecked implementation. The following decisions
must be recorded before their respective work begins:

1. **ADR-0002 — Structured diagnostics and guarded repair:** exact `Problem` schema, severity,
   safety rules, scoring, and visual measurement contract.
2. **ADR-0003 — Sidecar v2 and presentation state:** migration, frame units, presets, fit policy,
   typography, export semantics, and theme operations.
3. **ADR-0004 — Transaction and runtime model:** atomic writes, locks, browser reuse, retry rules,
   CLI/MCP equivalence, and result schema.
4. **ADR-0005 — Constrained edge routing:** ELK spike results, fixed-node guarantees, fallback,
   waypoints, and performance limits.
5. **ADR-0006 — Local editor:** server security, source save semantics, operation timeline,
   undo/redo, file watching, and MCP concurrency.

## 23. Rollout and rollback

- Ship v0.2 capabilities behind no hidden state; users opt into repair explicitly.
- Preserve existing named tools and commands while adding parity.
- Read v1 logs indefinitely; write v2 only after a v2 operation is committed.
- Include `straightedge migrate --dry-run` before any bulk rewrite facility.
- Record the original sidecar bytes in transaction tests, not in a new backup file format.
- If presentation or routing policies prove unstable, disable the new operation at the schema/tool
  boundary; v1 logs and existing geometry operations continue to render.
- No migration may modify `.mmd` source.

## 24. Success measures

Track these measures per release and corpus:

- false-clean count and diagnostic kind;
- repair success rate and regression rate;
- percentage of transactions committed, reviewed, failed, or rolled back;
- cold and warm parse/measure/paint/check timings;
- browser launch failure rate and doctor resolution;
- percentage of requested frames satisfied without font reduction;
- number of manual sidecar edits required by CLI users;
- edge-crossing and routing fallback counts;
- editor operations that round-trip through CLI/MCP without state differences.

The roadmap is successful when a user can give an agent a flowchart and a destination frame, iterate
in natural language, and receive a result that Straightedge can defend as publishable—with every
visual decision still represented by ordinary Mermaid plus readable semantic operations.
