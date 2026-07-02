# Power BI MCP and pbi-cli Notes

Codex can currently see the installed `pbi` CLI, but no Power BI-specific MCP tools are exposed in this session.

## What Works Without MCP

- Export OCI Oracle data into CSV files.
- Write SQL, DAX, theme JSON, documentation, and PBIR source files.
- Validate or edit PBIR report projects with `pbi report` and `pbi visual` commands.

## What Needs a Live Power BI Bridge

Use `pbi connect` or a Codex-visible Power BI MCP server when Codex needs to:

- Inspect a running Power BI semantic model.
- Create model tables, columns, measures, relationships, partitions, or calendars directly.
- Execute DAX against the live model.
- Export or import TMDL from an open Desktop model.

## Local Check

Open Power BI Desktop with a PBIX/PBIP model, then run:

```powershell
pbi setup --info
pbi connect
pbi --json model stats
pbi --json table list
```

If these work, Codex can use `pbi-cli` even without MCP. If you want Codex to use the VS Code MCP server directly, the same MCP server must be configured for Codex so its tools appear in tool discovery.
