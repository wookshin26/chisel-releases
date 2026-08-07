---
name: chisel-status
description: Report the current read-only status of projects open in Chisel, including compile and review state. Use when the user asks what Chisel has open or whether a paper is healthy.
---

# Chisel status

Use only Chisel MCP read tools. Do not compile, run scripts, or create proposals.

1. Call `list_projects`.
2. If no project is open, say so. If Chisel returns `app-not-running`, tell the user to open Chisel and enable **Settings → MCP server**. Never launch Chisel yourself.
3. For each returned project, call `get_compile_diagnostics` and `get_review_state`. Use `get_project_map`, `get_outline`, `list_artifacts`, or `list_figures` only when they clarify the requested status.
4. Summarize the project name/path label, latest compile outcome and diagnostic count, and review round/state. Distinguish “not compiled” from a successful compile and “no review round” from an empty round.
5. Keep all file reads bounded and do not infer state that the tools did not return.
