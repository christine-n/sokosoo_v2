# Local code graph

Graphify is installed in `.venv-graphify` and registered as a project skill under
`.agents/skills/graphify`. VS Code can start its local stdio MCP server using
`.vscode/mcp.json`; no hosted service or API key is needed.

Use the local graph for cross-file symbol relationships and architecture
questions when `graphify-out/graph.json` exists. Confirm relevant source before
editing; the graph can become stale after source changes.

From the repository root in PowerShell, rebuild without external model calls:

```powershell
.\.venv-graphify\Scripts\graphify.exe extract . --code-only --max-workers 2
.\.venv-graphify\Scripts\graphify.exe cluster-only . --no-label
```

Use this repository environment rather than auto-installing Graphify globally.
Keep analysis local and code-only. Do not upload source, configure Graphify Cloud
or semantic providers, or run model-based labelling as part of this setup.
Generated graphs, caches and the Python environment are ignored by Git.
Installation and query examples are in README.md.
