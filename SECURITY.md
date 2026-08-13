# Security policy

## Supported versions

Until the first stable release, security fixes are made only on the latest `0.2.0-alpha` release
and the default branch. Older previews are unsupported.

## Report a vulnerability privately

Do not open a public issue for exploitable editor-token, path-boundary, Mermaid-rendering, or
dependency vulnerabilities. Use [GitHub private vulnerability reporting](https://github.com/gmjen/straightedge/security/advisories/new).
Expect acknowledgement within 3 business days and an initial assessment within 7 business days.
Please include reproduction steps, impact, affected versions, and suggested mitigations if known.

## Trust boundary

The editor binds to `127.0.0.1`, requires an unguessable per-session token, and exposes only the
selected Mermaid document plus its layout/recovery state. It is a local development tool, not a
remotely hosted multi-user service. Mermaid runs with `securityLevel: "strict"` and HTML labels
disabled, but callers should still treat untrusted diagram input as untrusted content.

Straightedge has no telemetry and sends no diagram content to a Straightedge service. Installing
dependencies and the MCP host chosen by a user can have their own network behavior. Remote editor
exposure, account authentication, and collaboration are not supported.

GitHub-hosted CI sets `STRAIGHTEDGE_CHROMIUM_NO_SANDBOX=1` because the disposable runner cannot
use Chromium's process sandbox. This is an explicit trusted-CI escape hatch, not a normal runtime
setting. Do not set it when rendering untrusted Mermaid input or running Straightedge on a shared
host.
