# Straightedge

**Tell your agent how the diagram should look.**

<!-- TODO: before/after GIF goes here, above everything else.
     A README arguing for visual quality with no pictures in it is self-defeating.
     Ugly agent-generated architecture diagram → "make it presentation ready" → clean 16:9. -->

```
"Put the database below the workers."

"Align those three services."

"Make these boxes the same width."

"Make circle Y about 10% smaller."

"Fit this to a 16:9 slide."

"Nudge that one right a bit."
```

Straightedge is an open-source Mermaid layout plugin and MCP server that gives agents structured
control over node position, size, alignment, spacing, and style. Your `.mmd` file stays ordinary
Mermaid; what you said about the layout is recorded next to it as a small, readable list of
operations.

```
pipeline.mmd            ← Mermaid. Yours. We only read it.
pipeline.layout.json    ← what you asked for. Safe to delete.
```

Delete the layout file and you have a plain Mermaid diagram with default layout. Nothing is lost
that you didn't explicitly ask for.

## Why not just store the coordinates?

Because they stop meaning anything the moment the diagram changes. Add one node, ELK re-lays-out,
and your saved positions describe a layout nobody has ever seen.

Straightedge stores the *instructions* instead:

```json
{
  "version": 1,
  "ops": [
    { "op": "equalize_size", "nodes": ["ingest", "enrich", "model"], "dimension": "width" },
    { "op": "distribute_nodes", "nodes": ["ingest", "enrich", "model"], "axis": "horizontal", "gap": 64 },
    { "op": "place_relative", "node": "db", "reference": "model", "side": "below", "gap": 80 }
  ]
}
```

Replay those against a fresh layout and "align these three" is still an alignment. No constraint
solver, no DSL to learn, and a diff you can read in a pull request.

## Status

**v0.2 implements the trust-first conversational loop.** Straightedge now measures final DOM text,
rejects publication-blocking edits before they reach the sidecar, returns structured problems and
safe repair operations, and shares one atomic transaction engine across its CLI, MCP server, and
local editor.

It also includes:

- shape-aware, center-preserving resizing with unscaled labels;
- exact slide, A4, and README presentation frames with minimum-font checks;
- three curated themes and semantic node roles;
- obstacle-aware rerouting for touched or explicitly selected edges;
- atomic v1/v2 sidecars with concurrent-write protection;
- actionable Chromium diagnostics through `straightedge doctor`; and
- one reusable browser session per MCP server or editor session.

Flowcharts without subgraphs remain the intentionally narrow supported scope. The historical v0.1
constraints are documented in [SPEC.md](./SPEC.md), and the governing architectural decisions and
remaining breadth gates are in [ADR-0001](./docs/adr/0001-trust-first-evolution.md).

## Install

```bash
npm install
npm run build
```

```bash
node dist/cli.js render pipeline.mmd
node dist/cli.js inspect pipeline.mmd
node dist/cli.js check pipeline.mmd
node dist/cli.js edit pipeline.mmd
node dist/cli.js doctor
node dist/cli.js mcp
```

`render` writes a PNG beside the Mermaid source by default. Add `--svg` for SVG output.

Common conversational mutations now have CLI equivalents:

```bash
node dist/cli.js align pipeline.mmd ingest enrich model --edge top
node dist/cli.js distribute pipeline.mmd ingest enrich model --axis horizontal --gap 64
node dist/cli.js resize pipeline.mmd db --scale 0.9
node dist/cli.js frame pipeline.mmd slides-16:9
node dist/cli.js theme pipeline.mmd executive-light
node dist/cli.js repair pipeline.mmd
```

Use `apply` with a JSON array when one request requires several operations. The batch renders and
checks in memory, then commits once. If an error remains—such as clipped text, overlap, an edge
crossing, an obscured arrowhead, or unreadable frame scaling—the sidecar remains byte-identical.

```bash
npm test          # fast layout-engine tests
npm run test:coverage # Node coverage report for pure/domain modules
npm run test:e2e  # build and verify real Chromium paint output
npm run test:all  # type-check plus both suites
```

## Connect an AI agent

Build the package, then configure your MCP client to run this command from the repository:

```json
{
  "mcpServers": {
    "straightedge": {
      "command": "node",
      "args": ["/absolute/path/to/straightedge/dist/cli.js", "mcp"]
    }
  }
}
```

The useful loop is intentionally small:

1. Ask the agent to create or open a Mermaid flowchart.
2. Describe the visual change in plain language.
3. The agent inspects real node IDs and submits the visual intent as one semantic transaction.
4. Straightedge renders once, measures labels and shapes in Chromium, checks geometry and the target
   frame, then either commits or rolls back.
5. The agent receives the image, exact applied operations, frame status, and structured problems or
   suggested repairs before continuing the conversation.

Every committed operation is appended atomically to `<name>.layout.json`. `undo` removes the last
one; `reset_layout` deletes the sidecar and returns to a fresh ELK baseline. The local editor writes
the same operations: drag records `move_node`, resize records `resize_node`, and its align and
distribute controls use the same transaction API as the agent. Undo persists by popping the log;
redo is intentionally scoped to the current editor session and clears after a new branch of work.

## Contributing

At this stage, examples are worth more than code. Open an issue with a diagram you gave up on:

1. the Mermaid source
2. what it renders as
3. how you wish you could adjust it

That's what decides which operations exist.

## License

Apache-2.0
