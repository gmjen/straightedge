# ADR-0008: Conda packaging and one-line Pixi distribution

- **Status:** Proposed; design only, not implemented
- **Date:** 2026-08-12
- **Decision scope:** Packaging the complete Straightedge CLI and MCP runtime as Conda artifacts
  that Pixi can install globally
- **Supersedes:** None
- **Related:** ADR-0001, ADR-0007

## 1. Decision

Straightedge will be prepared for a future one-line Pixi installation:

```bash
pixi global install straightedge \
  --channel https://conda.anaconda.org/straightedge \
  --channel conda-forge
```

This ADR does **not** add a recipe, workflow, Anaconda.org account, secret, package, or release. It
defines the work and release gates required before that command can be documented as supported.

The first Conda release will use `rattler-build` schema v1, take its Node.js runtime from
`conda-forge`, and publish platform-specific `.conda` artifacts to a proposed Anaconda.org owner
named `straightedge`. The owner does not exist as of this decision and must be reserved before any
implementation begins.

The package will contain the same compiled Straightedge application and exact production npm
dependency graph as the npm tarball. It will also contain the exact Chrome for Testing build pinned
by Straightedge's Puppeteer version, subject to a blocking redistribution review. Including the
browser is what makes the installation complete rather than a thin wrapper that fails on first use
or downloads an uncontrolled browser later.

Initial platform scope is:

| Conda subdir | Status | Reason |
|---|---|---|
| `linux-64` | Required | Current Linux support and CI evidence; Chrome for Testing is available |
| `osx-64` | Required | Current macOS support; Chrome for Testing is available |
| `osx-arm64` | Required | Current macOS support; Chrome for Testing is available |
| `linux-aarch64` | Deferred | Chrome for Testing does not publish Linux ARM64 binaries |
| `win-64` | Deferred | Straightedge does not yet claim Windows support or have Windows E2E evidence |

This is deliberately **not** a `noarch` package. Straightedge's TypeScript is architecture-neutral,
but its browser payload is not.

## 2. Desired user journey

After a stable release, a user with Pixi installed should be able to run the command above and then,
from an unrelated directory and without Node.js, npm, or a preinstalled browser on the host, run:

```bash
straightedge doctor --json
straightedge render diagram.mmd
straightedge mcp
```

An MCP client configuration should be only:

```json
{
  "mcpServers": {
    "straightedge": {
      "command": "straightedge",
      "args": ["mcp"]
    }
  }
}
```

`pixi global install` exposes command-line applications from the installed environment, so users
must not need to know the environment path or invoke `node dist/cli.js`. Pixi's normal activation
must remain enabled; `--no-activation` is outside the supported path because the launcher relies on
the tool environment's `PATH` and `CONDA_PREFIX`.

For an alpha release, the equivalent opt-in command will use an Anaconda label and a Conda-normalized
version:

```bash
pixi global install "straightedge=0.2.0a1" \
  --channel https://conda.anaconda.org/straightedge/label/dev \
  --channel conda-forge
```

Stable packages go to the default `main` label. Alpha, beta, and release-candidate packages go only
to `dev` until promoted by a separate, auditable action.

## 3. Evidence and constraints

The design follows the useful release shape in
[`grej/pixi-publish-to-anaconda`](https://github.com/grej/pixi-publish-to-anaconda):

- a schema-v1 `recipe.yaml`;
- a version supplied through `PKG_VERSION` and `${{ env.get("PKG_VERSION") }}`;
- tag-triggered GitHub Actions builds;
- `rattler-build upload anaconda` with an `ANACONDA_TOKEN` secret; and
- the project channel listed before `conda-forge` in the Pixi command.

The reference recipe is for a pure Python `noarch` package. Straightedge differs in three material
ways:

1. it is a Node.js application whose package lock must govern the npm dependency tree;
2. Chromium is part of its runtime correctness contract, not an optional testing dependency; and
3. Chrome for Testing is platform-specific and has additional Linux shared-library requirements.

Current upstream facts reinforce those constraints:

- Puppeteer 25 requires Node.js 22.12 or newer and pins a compatible Chrome for Testing build;
- Puppeteer's normal installation downloads both Chrome for Testing and Chrome Headless Shell into
  a user cache, which is unsuitable as an implicit Conda build side effect;
- Chrome for Testing currently supports Linux x64, macOS x64/ARM64, and Windows x64, but not Linux
  ARM64;
- Puppeteer warns that its Linux browser archive still needs host shared libraries; and
- Pixi does not run Conda post-link scripts by default, so a package cannot quietly defer browser
  installation to an install hook and still keep the desired command.

As of 2026-08-12, Anaconda.org's public API reports no `grej`, `gmjen`, or `straightedge` owner and
no `straightedge` package under those names. It also reports no `chromium`, `chromium-browser`, or
`google-chrome` package in `conda-forge`. Those observations are time-sensitive and must be checked
again during implementation.

## 4. Package boundary

Each artifact will contain:

```text
$PREFIX/
  bin/
    straightedge                 # launcher generated by the recipe
  lib/node_modules/straightedge/
    package.json
    LICENSE
    README.md
    SPEC.md
    dist/
    node_modules/                # exact production graph from package-lock.json
  libexec/straightedge/chrome/
    ...                          # one pinned Chrome for Testing build
  share/licenses/straightedge/
    LICENSE
    npm-production-licenses.txt
    chrome-notices/
```

The Conda runtime dependency will include `nodejs >=22.12,<23` from `conda-forge`. The package will
not carry a second Node.js binary.

The browser archive will be downloaded as an explicit recipe source with a committed URL and SHA-256
for each platform. The build must skip Puppeteer's install scripts so it cannot download Chrome,
Chrome Headless Shell, or Firefox behind the recipe's back. Only the one reviewed browser source is
copied into the artifact.

The launcher will:

1. fail clearly if Pixi/Conda did not activate the tool environment and `CONDA_PREFIX` is absent;
2. set `STRAIGHTEDGE_CHROMIUM_EXECUTABLE` to the browser inside that prefix;
3. preserve Chromium sandboxing by default; and
4. execute `$CONDA_PREFIX/bin/node` with the installed `dist/cli.js`, forwarding all arguments and
   exit codes.

Before packaging, Straightedge must add `STRAIGHTEDGE_CHROMIUM_EXECUTABLE` as a documented browser
override. `browserExecutable()` must validate the path before checking fixed macOS system locations.
`doctor --json` must report the resolved executable and whether its source is `explicit`, `system`,
or `puppeteer-cache`. This is a future application change, not part of this ADR-only commit.

## 5. Browser redistribution gate

The Chrome for Testing dashboard and metadata repository are Apache-2.0, but that repository license
does not by itself establish redistribution rights for the Chrome executable. The executable is also
covered by Chrome terms and component notices. Therefore:

- no browser-containing package may be uploaded until a maintainer records a redistribution review;
- the review must identify the terms that permit the exact artifact to be mirrored inside a public
  Conda package and the notices that must accompany it;
- the recipe must include those notices, not merely Straightedge's BSD-3-Clause license; and
- CI must fail when a browser version changes without corresponding URL, SHA-256, and notice updates.

If that review does not approve redistribution, the team must return to this ADR. The fallback is a
thin platform-neutral application package plus an explicit `straightedge browser install` step that
downloads from Google's canonical URL into a user cache. That fallback keeps the Conda package legal
but does **not** satisfy the fully operational one-line journey, and must not be presented as if it
does. A post-link download is rejected because Pixi requires users to opt into post-link scripts and
because hidden network mutation weakens reproducibility.

## 6. Source and dependency reproducibility

The recipe will build from a checkout of the exact protected release tag, using `source.path` for the
application and a checksum-pinned URL source for the browser. The tag workflow must verify all of the
following before building:

- the tag resolves to a commit reachable from protected `main`;
- the tag version exactly matches `package.json`;
- `package-lock.json` has lockfile version 3 and contains the same root version;
- a clean `npm ci --ignore-scripts` succeeds;
- the full repository test suite succeeds before any Conda artifacts are made; and
- the Puppeteer-to-Chrome mapping in the committed browser lock agrees with the installed Puppeteer
  metadata.

The npm payload will be assembled without a second dependency resolution:

1. run `npm ci --ignore-scripts` from the committed lock;
2. run the normal TypeScript build and package tests;
3. create the npm tarball with `npm pack --ignore-scripts`;
4. prune the working dependency tree with `npm prune --omit=dev --ignore-scripts`;
5. unpack the already-tested npm tarball into `$PREFIX/lib/node_modules/straightedge`; and
6. copy the pruned, lock-derived production `node_modules` beside it.

Running `npm install --global` on the tarball during the Conda build is not sufficient for
Straightedge: it can resolve declared ranges again and produce a production graph different from
`package-lock.json`. Current conda-forge npm recipes demonstrate the global-install pattern, but the
lock-preserving copy is the stronger fit for a browser-rendering tool whose output can change with a
dependency update.

The package's build manifest will record:

- Straightedge Git commit and tag;
- npm package version and normalized Conda version;
- Node.js build and Conda build number;
- Puppeteer version;
- Chrome for Testing version, URL, and SHA-256; and
- SHA-256 of the completed `.conda` artifact.

## 7. Version and build-number policy

The Git tag and `package.json` remain npm SemVer. Conda versions use a deterministic normalization:

| npm/tag version | Conda version | Anaconda label |
|---|---|---|
| `0.2.0-alpha.1` / `v0.2.0-alpha.1` | `0.2.0a1` | `dev` |
| `0.2.0-beta.2` / `v0.2.0-beta.2` | `0.2.0b2` | `dev` |
| `0.2.0-rc.3` / `v0.2.0-rc.3` | `0.2.0rc3` | `dev` |
| `0.2.0` / `v0.2.0` | `0.2.0` | `main` |

Any other prerelease form fails before build. The converter will be a tested repository script,
not an expanding chain of shell substitutions in the workflow.

Build number starts at `0` for every new application version. A packaging-only correction increments
the build number and preserves the application version. Normal publication must never pass
`rattler-build upload ... --force`: replacing the same name/version/build makes installed and cached
artifacts ambiguous. A mistaken artifact is moved to a broken label and superseded by a higher build
number.

## 8. Planned repository files

Implementation will add these files in one focused change:

```text
packaging/conda/
  recipe.yaml
  build.sh
  browser-lock.json
  README.md
scripts/
  conda-version.mjs
  verify-conda-payload.mjs
test/packaging/
  conda-version.test.mjs
  browser-lock.test.mjs
  payload.test.mjs
.github/workflows/
  conda-package.yml
  conda-publish.yml
```

Build and publish are separate workflows. Pull requests run `conda-package.yml`, build test artifacts,
and upload them only to GitHub Actions. A protected tag invokes `conda-publish.yml`, which calls the
same reusable build job and uploads only after the complete platform matrix succeeds.

## 9. Candidate recipe

The implementation should begin from the following shape. This is intentionally embedded here rather
than created as `packaging/conda/recipe.yaml` in this design-only change.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/prefix-dev/recipe-format/main/schema.json
schema_version: 1

context:
  name: straightedge
  version: ${{ env.get("PKG_VERSION") }}

package:
  name: ${{ name }}
  version: ${{ version }}

source:
  - path: ../..
    target_directory: source
  - url: ${{ env.get("CHROME_URL") }}
    sha256: ${{ env.get("CHROME_SHA256") }}
    target_directory: chrome-source

build:
  number: ${{ env.get("CONDA_BUILD_NUMBER") }}
  script:
    - bash source/packaging/conda/build.sh

requirements:
  build:
    - nodejs >=22.12,<23
  host:
    - nodejs >=22.12,<23
  run:
    - nodejs >=22.12,<23
    # linux-64 entries are completed from ldd evidence before implementation.

tests:
  - script:
      - straightedge --version
      - straightedge doctor --json
      - node $SRC_DIR/source/scripts/verify-conda-payload.mjs

about:
  homepage: https://github.com/gmjen/straightedge
  documentation: https://github.com/gmjen/straightedge#readme
  repository: https://github.com/gmjen/straightedge
  summary: Tell your agent how a Mermaid flowchart should look
  description: |
    Straightedge is an agent-facing CLI and MCP server for deterministic,
    replayable visual edits to Mermaid flowcharts.
  license: BSD-3-Clause AND LicenseRef-Chrome-for-Testing
  license_file:
    - source/LICENSE
    - npm-production-licenses.txt
    - chrome-notices/

extra:
  recipe-maintainers:
    - gmjen
```

`CONDA_BUILD_NUMBER`, `CHROME_URL`, and `CHROME_SHA256` are required environment values. As the
reference skill notes, rattler-build's `env.get()` form must not be given a made-up default argument.
The workflow reads all three from reviewed repository metadata and fails on an absent value.

The final Linux recipe must list the packages proven necessary by `ldd` against the staged Chrome
binary. Guessing a Debian package list into Conda names is not acceptable. The implementation job
must map every unresolved shared object to a `conda-forge` package, rebuild, and demonstrate an empty
`ldd ... | grep 'not found'` result in a minimal runner. Fonts required for stable Mermaid rendering
must also be explicit runtime dependencies or bundled, and visual snapshots must establish that the
font choice is the same across clean installs.

## 10. Candidate build script behavior

The future `build.sh` will use strict shell settings and implement this sequence:

```bash
set -euo pipefail

cd "$SRC_DIR/source"
export PUPPETEER_SKIP_DOWNLOAD=1
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm run test:package

npm pack --ignore-scripts
npm prune --omit=dev --ignore-scripts

install -d "$PREFIX/lib/node_modules/straightedge"
tar -xzf "straightedge-${NPM_VERSION}.tgz" \
  -C "$PREFIX/lib/node_modules/straightedge" --strip-components=1
cp -R node_modules "$PREFIX/lib/node_modules/straightedge/node_modules"

install -d "$PREFIX/libexec/straightedge/chrome"
# Copy the already checksum-verified, recipe-provided Chrome tree here.
# Do not run Puppeteer's downloader.

install -d "$PREFIX/bin"
# Generate the launcher with the platform-specific browser path.
# Generate and install npm and Chrome license notices.
```

Variables such as `NPM_VERSION` will be produced by a checked-in script and validated, not interpolated
from untrusted filenames. The actual script will use separate Unix and Windows branches only when
Windows becomes supported.

## 11. Candidate release workflow

The workflow will preserve the good mechanics of the reference skill while adding a build matrix,
test-before-publish separation, immutable artifacts, and a protected publishing environment:

```yaml
name: Publish Conda package

on:
  push:
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      tag:
        description: Existing protected release tag to rebuild
        required: true

permissions:
  contents: read
  id-token: write
  attestations: write

concurrency:
  group: conda-${{ github.ref }}
  cancel-in-progress: false

jobs:
  verify:
    # Check tag reachability, package/lock versions, full tests, version mapping,
    # browser lock, and release label. Expose normalized values as job outputs.

  build:
    needs: verify
    strategy:
      fail-fast: false
      matrix:
        include:
          - subdir: linux-64
            runner: ubuntu-24.04
          - subdir: osx-64
            runner: <reviewed-x64-macos-runner>
          - subdir: osx-arm64
            runner: macos-15
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@<pinned-commit>
      - uses: prefix-dev/setup-pixi@<pinned-commit>
      - run: pixi global install rattler-build
      - run: npm ci --ignore-scripts
      - run: npm run test:all
      - run: rattler-build build --recipe packaging/conda/recipe.yaml --output-dir dist/conda
      - run: pixi global install --path dist/conda/<the-built-package>.conda
      - run: npm run test:conda-installed
      - uses: actions/attest@<pinned-commit>
        with:
          subject-path: dist/conda/**/*.conda
      - uses: actions/upload-artifact@<pinned-commit>
        with:
          name: conda-${{ matrix.subdir }}
          path: dist/conda/**/*.conda

  publish:
    needs: [verify, build]
    environment: anaconda-production
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@<pinned-commit>
      - uses: prefix-dev/setup-pixi@<pinned-commit>
      - run: pixi global install rattler-build
      - run: >-
          rattler-build upload anaconda
          --owner straightedge
          --channel "${ANACONDA_LABEL}"
          --api-key "${ANACONDA_API_KEY}"
          <all-verified-conda-files>
        env:
          ANACONDA_API_KEY: ${{ secrets.ANACONDA_TOKEN }}
```

Implementation must pin third-party actions by immutable commit SHA. Runner labels shown here are
design intent; they must be checked against the then-current GitHub-hosted runner inventory before
the workflow is committed. The `anaconda-production` environment should require a maintainer approval
and limit deployment to protected tags.

The publish job downloads the exact artifacts built and attested by the matrix; it must not rebuild
them. It verifies their SHA-256 values against build outputs before upload. The token is visible only
to the publish job, never to pull-request jobs.

## 12. Required test coverage

Packaging is complete only when all of these checks run in automation.

### Pure and structural tests

- npm SemVer to Conda version conversion, including rejection of unsupported suffixes;
- tag, `package.json`, lockfile, recipe, and artifact version agreement;
- browser lock schema, supported platform completeness, HTTPS URL shape, and SHA-256 shape;
- Puppeteer version and pinned Chrome version agreement;
- package contents include only production dependencies, required documentation, and licenses;
- no build path, home directory, token, npm cache, or browser cache path leaks into the package;
- generated launchers preserve spaces and forward arguments and exit codes; and
- package metadata reports the expected platform and never `noarch`.

### Artifact tests on every target platform

Each test starts in a clean environment with no system Node.js and no discoverable system Chrome:

1. install the locally built `.conda` file with `pixi global install --path`;
2. assert `straightedge` is exposed outside the repository;
3. assert `straightedge --version` equals the release version;
4. assert `straightedge doctor --json` succeeds and reports the packaged browser path/version;
5. render a fixture to PNG and SVG;
6. inspect the outputs and confirm they are nonempty and contain the expected node labels;
7. run the shape-aware resize fixture and its browser-derived text-containment checks;
8. start `straightedge mcp` over stdio, complete MCP initialization, list tools, call `inspect`, call
   a mutation, and verify the structured response;
9. terminate the server cleanly and assert Chromium child processes are gone; and
10. repeat `doctor` and one render with outbound networking disabled to prove the package does not
    download at runtime.

### Linux-specific tests

- `ldd` reports no missing libraries for the packaged Chrome executable;
- Chromium launches with its sandbox enabled in the supported clean-host configuration;
- `STRAIGHTEDGE_CHROMIUM_NO_SANDBOX` remains an explicit opt-out and is not set by the package; and
- a non-root user can render into a writable directory.

### Install-channel test before promotion

After upload to the `dev` label, a clean runner must execute the documented Pixi command against the
remote Anaconda channel, repeat the artifact tests, and confirm the solved `nodejs` came from
`conda-forge`. Stable promotion is blocked until all three initial platforms pass this remote test.

## 13. Release safety and supply-chain controls

- Reserve the `straightedge` Anaconda owner with MFA and at least two maintainers before adding a
  repository secret.
- Store a least-privilege upload token as `ANACONDA_TOKEN` in the protected GitHub environment.
- Give pull-request workflows read-only permissions and no secrets.
- Protect release tags or create them only from the GitHub release workflow.
- Pin actions and the setup-pixi action by commit; record the human-readable release in comments.
- Generate GitHub artifact attestations for every `.conda` artifact.
- Upload only checksum-matched artifacts from the completed matrix.
- Do not use `--force` in normal uploads.
- Generate a production npm license inventory and preserve Chrome notices in the artifact.
- Run the existing package audit and a Conda dependency/SBOM scan before publication.
- Keep Chromium sandboxing enabled; packaging must not normalize the CI-only no-sandbox escape hatch.

## 14. Rollout

Implementation is divided into reviewable stages:

1. **Identity and legal:** reserve the owner, decide maintainer access, and complete the Chrome
   redistribution review.
2. **Runtime seam:** add and test the explicit browser override and richer doctor reporting.
3. **Local recipe:** add the recipe, browser lock, launchers, license collection, and local artifact
   tests; publish nothing.
4. **CI build:** build all three artifacts on pull requests and retain them as workflow artifacts.
5. **Dev publication:** add the protected upload job and publish an alpha to the `dev` label.
6. **Remote acceptance:** install from Anaconda.org with the exact prerelease Pixi command on clean
   runners, including offline runtime tests.
7. **Stable publication:** publish a stable tag to `main` and add the one-line command to the README.
8. **Later breadth:** evaluate Windows only after native Windows product E2E passes; evaluate Linux
   ARM64 only when a supported browser distribution exists.

Until stage 7 passes, the README must continue to describe source installation and must not imply
that `pixi global install straightedge` works.

## 15. Failure and rollback

- A failed platform blocks the whole release; partial matrices are not promoted.
- A bad `dev` artifact is relabeled broken and replaced with an incremented Conda build number.
- A bad stable artifact is relabeled broken, followed by a higher build number and a security or
  release note as appropriate. Existing bytes are never overwritten.
- If Chrome licensing, sandboxing, or platform dependencies cannot meet the acceptance contract,
  the browser-containing plan stops. Maintainers amend this ADR before choosing the thin-package
  fallback.
- npm and Conda releases use the same application source tag. A channel must never carry a Conda
  build that identifies itself as a different npm version.

## 16. Alternatives considered

### `noarch: generic` with Puppeteer's install hook

Rejected. The downloaded browser is platform-specific, install hooks introduce hidden network
mutation, and Pixi does not run post-link scripts by default.

### `noarch: generic` with a required system browser

Deferred as the legal fallback. It is small, but it makes rendering depend on an unpinned host
browser and does not provide the complete MCP server in one install.

### Depend on a conda-forge Chromium package

Preferred in principle, but none was found during this decision. If a maintained package later
appears with versions compatible with Puppeteer, this ADR should be revisited because that would
reduce artifact size and separate browser security updates from Straightedge releases.

### Download a browser on first launch

Rejected for the primary path. First-run network access makes MCP startup unpredictable and defeats
offline and checksum-contained installation.

### Publish only npm and have Conda run npm globally

Rejected. It makes Conda installation a second mutable package-manager transaction and loses the
single audited artifact boundary.

### Submit directly to conda-forge

Deferred. A personal/project Anaconda channel gives the alpha room to prove platform support and
release mechanics. Once stable, a separate conda-forge feedstock can reuse the recipe and its tests.

## 17. Consequences

The positive consequence is a genuinely small user journey: Pixi installs Node.js, Straightedge,
its exact JavaScript runtime, and its verified browser, then exposes one `straightedge` command for
both CLI and MCP use.

The costs are material: artifacts will be large, every Puppeteer/browser change requires platform
builds, Linux shared-library and sandbox behavior must be maintained, and Chrome redistribution must
be affirmatively cleared. Those costs are preferable to calling a thin wrapper a complete install.

## 18. References

- [Reference publishing skill](https://github.com/grej/pixi-publish-to-anaconda)
- [Pixi global install](https://pixi.sh/latest/reference/cli/pixi/global/install/)
- [rattler-build recipe format](https://rattler.build/latest/reference/recipe_file/)
- [rattler-build Anaconda upload command](https://rattler-build.prefix.dev/latest/reference/cli/rattler-build/upload/anaconda/)
- [conda-forge Node.js feedstock](https://github.com/conda-forge/nodejs-feedstock)
- [A current conda-forge npm CLI recipe](https://github.com/conda-forge/openspec-feedstock/blob/main/recipe/recipe.yaml)
- [Puppeteer installation and browser downloads](https://pptr.dev/guides/installation)
- [Puppeteer system requirements](https://pptr.dev/guides/system-requirements)
- [Puppeteer Linux and sandbox troubleshooting](https://pptr.dev/troubleshooting)
- [Chrome for Testing availability](https://github.com/GoogleChromeLabs/chrome-for-testing)
- [Conda version ordering](https://docs.conda.io/projects/conda/en/latest/user-guide/concepts/pkg-specs.html#version-ordering)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
