---
name: chisel-compile-fix
description: Compile an open Chisel paper, diagnose a LaTeX failure, and park a minimal fix for explicit in-app approval. Use for Chisel compile errors and repair loops.
---

# Chisel compile and fix

All changes must pass through Chisel's proposal review card. Never bypass that gate with filesystem editing tools.

1. Resolve the target with `list_projects`; pass its opaque `projectId` on every later call when more than one project is open.
2. Call `compile`. It flushes every attached Chisel editor before compiling. If it returns `flush-timeout`, stop and show that error to the user; do not diagnose or modify files from potentially stale disk state.
3. Inspect the returned diagnostics. Use `get_compile_diagnostics`, `get_outline`, `search_project`, and bounded `read_file` calls to locate the smallest defensible fix.
4. Use `propose_edit` for an existing file or `propose_new_file` only when a new file is necessary. Keep the proposal minimal and explain the diagnostic it addresses.
5. Tell the user that the proposal is parked in Chisel and must be approved there. Call `wait_for_proposal` with at most 60 seconds per wait. Do not treat a timeout as approval. If rejected, stop unless the user asks for a revised proposal.
6. After an `applied` result, call `compile` again and report the new diagnostics. Respect Chisel's compile rate limit (four calls per minute); never spin or immediately retry a throttled call.
7. Repeat only while each iteration is evidence-based and user approval remains explicit.
