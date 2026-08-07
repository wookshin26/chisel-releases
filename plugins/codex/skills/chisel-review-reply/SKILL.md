---
name: chisel-review-reply
description: Read an existing external-review round in Chisel and park a response.tex draft for explicit approval. Use when drafting replies to reviewer points.
---

# Chisel review reply

Draft responses only. MCP v1 must not create, edit, reorder, resolve, or otherwise mutate review points or imported referee reports.

1. Resolve the project with `list_projects`, then call `get_review_state` to identify the active external-review round.
2. Use `get_project_map` under the active `review/external/round-N/` directory. Read `points.json`, the existing `response/response.tex` when present, and only the bounded paper files needed to support the replies.
3. Draft a professional point-by-point LaTeX response. Preserve each point's identity and ordering. Do not claim that the manuscript changed unless the cited project content confirms it.
4. Target only `review/external/round-N/response/response.tex`: use `propose_edit` when it exists or `propose_new_file` otherwise. Never propose changes to `points.json`, `round.json`, `plan.md`, or files under `reports/`.
5. Tell the user the draft is parked in Chisel for review. Use `wait_for_proposal` for the decision and never treat timeout as approval. Report applied, rejected, superseded, or project-closed outcomes exactly.
