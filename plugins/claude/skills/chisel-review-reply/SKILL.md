---
name: chisel-review-reply
description: Read an existing external-review round in Chisel and park a response.tex draft for explicit approval. Use when drafting replies to reviewer points.
---

# Chisel review reply

Draft responses only. For the full external cycle (report import, plan, point responses, referee diff) use the chisel-review skill. MCP v1 must not create, edit, reorder, resolve, or otherwise mutate review points or imported referee reports.

1. Resolve the project with `list_projects`, then call `get_review_state` to identify the active external-review round.
2. Use `get_project_map` under the active `review/external/round-N/` directory. Read `points.json`, the existing `response/response.tex` when present, and only the bounded paper files needed to support the replies.
3. Draft a professional point-by-point LaTeX response. Preserve each point's identity and ordering. Do not claim that the manuscript changed unless the cited project content confirms it.
4. Target only the latest unsealed external round's response letter through `propose_response_draft`: pass `content` for the first draft when `response/response.tex` does not exist, or 1-50 exact SEARCH/REPLACE `edits` when it does. Generic `propose_edit`/`propose_new_file` are always denied under `review/**`; never attempt them there, and never propose changes to `points.json`, `round.json`, `plan.md`, or files under `reports/`. A round already recorded as submitted is sealed and rejects drafts.
5. Tell the user the draft is parked in Chisel for review. Use `wait_for_proposal` for the decision and never treat timeout as approval. Report applied, rejected, superseded, or project-closed outcomes exactly.
