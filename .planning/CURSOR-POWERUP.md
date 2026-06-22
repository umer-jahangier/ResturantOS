# Cursor Power-Up — 2026-06-22

| Step | Status |
|------|--------|
| CodeGraph | initialized (no code yet — greenfield) |
| GitNexus | analyzed (436 nodes from docs) |
| Cursor rules | 85 rules in .cursor/rules/ |
| .gitignore | created |

## Agent instructions
- Prefer CodeGraph/GitNexus MCP tools over blind grep when exploring structure.
- Source of truth: Docs/RestaurantERP_SaaS_Specification.md + Docs/RestaurantERP_UserStories_FlowDiagrams.md + Docs/agent-specs/*.md (11 agent specs).
- Use global skills from ~/.cursor/skills/ (security, performance, clean-code).
- Persist decisions via agentmemory MCP when the server is running.
- GSD artifacts live in .planning/ — read PROJECT.md and STATE.md before large changes.

## User reminders
- Global: `agentmemory` running, `GITHUB_PERSONAL_ACCESS_TOKEN` for GitHub MCP
- Re-index after major refactors: `bash ~/.cursor/get-shit-done/scripts/cursor-powerup-reindex.sh`

## Last re-index: 2026-06-23T01:51
