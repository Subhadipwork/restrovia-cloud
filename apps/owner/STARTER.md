# Starter source

This app was copied from
[Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter)
(MIT License, see `LICENSE`) at commit `47da494b89e330d884a0f9b5c37a605fbabb3987` (2026-11-02).

Left out of the copy: the starter's git history, AI-agent instruction files (`AGENTS.md`,
`CLAUDE.md`, `.claude/`, `.agents/`), git hooks (`.husky/`), `.github/` and editor settings.

Changes made for Restrovia:

- Ran the starter's cleanup script for Clerk, kanban, chat, AI chat, notifications, examples and
  Sentry, then removed the products and users demos, the mock data, the help sidebar, the docs and
  the Bun and Docker files.
- Sign-in uses the Restrovia Cloud API (`/api/owner`): email, password and an optional
  authenticator code. There is no Clerk.
- Restrovia screens live in `src/features/account` and `src/features/auth`; the layout, sidebar, UI
  components and themes are the starter's.
- npm workspace package `@restrovia/owner` instead of Bun.
- Started as a copy of `apps/admin`, which had already been through the steps above.

The starter's `scripts/cleanup.js` is kept for reference in `apps/admin` only.
