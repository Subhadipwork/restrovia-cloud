# Starter source

This app was copied from
[Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter)
(MIT License, see `LICENSE`) at commit `47da494b89e330d884a0f9b5c37a605fbabb3987` (2026-11-02).

Left out of the copy: the starter's git history, AI-agent instruction files (`AGENTS.md`,
`CLAUDE.md`, `.claude/`, `.agents/`), git hooks (`.husky/`), `.github/` and editor settings.

Not yet adapted. Before this app is used (owner portal: phase 4; admin panel: phase 5):

1. Run the starter's cleanup script to remove the demo features.
2. Remove Clerk and connect sign-in to the Restrovia Cloud API.
3. Leave the Sentry DSN empty, switch scripts from Bun to npm, and add the app to the root workspaces.
