# Chisel for Codex

This plugin connects Codex to the MCP server built into the Chisel desktop app. Read operations are bounded; edits, runs, and other consequential actions are parked as cards that must be approved inside Chisel. The bridge never launches Chisel.

## Requirements

- Apple Silicon Mac (`darwin-arm64`) or Windows 11 x64; these are the v1 discovery-path contracts.
- Chisel with **Settings → MCP server** enabled.
- Node.js 20 or newer and a Codex release with plugin support. The bridge is started as `node bin/chisel-mcp.mjs`, so no shebang or executable bit is involved on either OS.

Chisel writes a process-scoped bearer record to `~/Library/Application Support/Chisel/mcp.v1.json` (macOS, mode `0600`) or `%APPDATA%\Chisel\mcp.v1.json` (Windows, readable by your account only — the bridge checks the file's DACL through PowerShell and refuses a file that Everyone, Users, or Authenticated Users can read). The bridge reads this file locally, watches for atomic replacement, and reconnects when Chisel restarts or rotates the token. It never prints the token.

## Prepare the plugin

From the Chisel repository root, materialize the bridge's pinned runtime dependency:

```sh
npm --prefix plugin/codex ci --omit=dev --ignore-scripts
```

The source package is ready to place at `plugins/chisel` inside a Codex personal or repository marketplace. Its manifest is `.codex-plugin/plugin.json`; its MCP entry sets a plugin-relative working directory and launches `bin/chisel-mcp.mjs` from there. Installing it does not require copying secrets into Codex.

After installation, invoke a bundled skill explicitly with `$` or let Codex select it from the request:

- `$chisel-status`
- `$chisel-compile-fix`
- `$chisel-review`
- `$chisel-referee`
- `$chisel-experiment`
- `$chisel-figure`
- `$chisel-literature`
- `$chisel-idea`
- `$chisel-manuscript`

## First smoke test

1. Open a project in Chisel and enable **Settings → MCP server**.
2. Install the prepared package from a configured Codex marketplace, then start a new Codex thread.
3. Run `$chisel-status` and confirm it reports the open project without changing it.
4. Run `$chisel-compile-fix` on a known LaTeX diagnostic.
5. Confirm a proposal card with an external MCP origin appears in Chisel, inspect it, and approve or reject it yourself.
6. Rotate the MCP token in Chisel Settings and run the status skill again. The same Codex session should reconnect automatically.

If Chisel is closed or MCP is disabled, the stdio bridge still initializes. Tool calls return the typed result `{"error":{"code":"app-not-running",...}}`; open Chisel and enable the server, then retry.

## Discovery override

Tests and non-default app-data layouts can point at another v1 discovery file:

```sh
CHISEL_MCP_CONFIG=/absolute/path/to/mcp.v1.json codex
```

The override must still be a v1 JSON file with restrictive permissions (`0600` on macOS, a user-private DACL on Windows). It does not add support for another discovery schema. Linux paths are intentionally outside the v1 contract.

Set `CHISEL_MCP_DEBUG=1` only for local troubleshooting. Diagnostics go to stderr and never include the bearer token.
