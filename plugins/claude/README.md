# Chisel for Claude Code

This plugin connects Claude Code to the MCP server built into the Chisel desktop app. Read operations are bounded; edits and Numerics runs are parked as cards that must be approved inside Chisel. The bridge never launches Chisel.

## Requirements

- Apple Silicon Mac (`darwin-arm64`); this is the only v1 discovery-path contract.
- Chisel with **Settings → MCP server** enabled.
- Node.js 20 or newer and Claude Code.

Chisel writes a process-scoped bearer record to `~/Library/Application Support/Chisel/mcp.v1.json` with mode `0600`. The bridge reads this file locally. It watches the containing directory and reconnects automatically when Chisel restarts or rotates the token. The token is never printed by the bridge.

## Install and load locally

From the Chisel repository root, install the bridge's one pinned runtime dependency:

```sh
npm --prefix plugin/claude ci --omit=dev --ignore-scripts
```

Then load the plugin in Claude Code:

```sh
claude --plugin-dir ./plugin/claude
```

Claude Code caches marketplace-installed plugins, so published installation should package the same directory after `npm ci` has materialized its runtime dependency. For source/development smoke testing, `--plugin-dir` loads this directory directly.

Current Claude Code releases namespace plugin skills. Invoke:

- `/chisel:chisel-status`
- `/chisel:chisel-compile-fix`
- `/chisel:chisel-review`
- `/chisel:chisel-referee`
- `/chisel:chisel-experiment`
- `/chisel:chisel-figure`
- `/chisel:chisel-literature`
- `/chisel:chisel-idea`
- `/chisel:chisel-manuscript`

Some older clients display the corresponding unscoped aliases, such as `/chisel-status` instead of `/chisel:chisel-status`.

## First smoke test

1. Open a project in Chisel and enable **Settings → MCP server**.
2. Start Claude Code with the plugin directory as shown above.
3. Run `/chisel:chisel-status` and confirm it reports the open project without changing it.
4. Run `/chisel:chisel-compile-fix` on a known LaTeX diagnostic.
5. Confirm a proposal card bearing an external MCP origin appears in Chisel, inspect it, and click approve or reject yourself.
6. In Chisel Settings, rotate the MCP token and run the status skill again. The same Claude Code session should reconnect automatically.

If Chisel is closed or MCP is disabled, the stdio bridge still initializes. Tool calls return the typed result `{"error":{"code":"app-not-running",...}}`; open Chisel and enable the server, then retry.

## Discovery override

Tests and non-default app-data layouts can point at another v1 discovery file:

```sh
CHISEL_MCP_CONFIG=/absolute/path/to/mcp.v1.json claude --plugin-dir ./plugin/claude
```

The override must still be a v1 JSON file with restrictive permissions (`0600`). It does not add support for a different discovery schema. Windows and Linux paths are intentionally not contracted in v1.

Set `CHISEL_MCP_DEBUG=1` only for local troubleshooting. Diagnostics go to stderr and never include the bearer token.
