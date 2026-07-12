# Agent Session Monitor

A local dashboard for watching Codex CLI and Claude Code sessions on macOS.

## What is this?

Agent Session Monitor shows your local coding-agent sessions on one page. It reads Codex's local SQLite database, reads Claude Code's local JSON Lines (JSONL) transcript files, and checks local operating system processes. It runs without a login or cloud backend, and it does not send your session data to an added external service.

## Why you might want it

It can be hard to track many sessions across many projects. One session may fail. Another may wait for input or keep using tokens.

This dashboard puts the sessions in one table. It sorts the sessions with the worst state first. It updates the table as local session data changes.

## Features

- **One session table.** See Codex CLI and Claude Code sessions together. Each row shows its source.
- **Live updates.** The first state uses HTTP, and later updates use SSE (Server-Sent Events, a way for the server to push live updates to your browser). The server polls the local tools and compares their state because the tools do not provide their own push updates.
- **A table for many rows.** The table only renders the rows that are visible. It has sticky main columns, resizable columns, two density options, keyboard navigation, bulk selection, and bulk actions.
- **Session details.** Open the Overview, Logs, or Changes tab for a session. The log view reads only a limited tail of the source transcript, not the full log.
- **Honest cost.** Claude Code cost uses recorded per-message token data and Anthropic's published rates. Codex cost is always `—` because its local state has no pricing data.
- **Honest progress.** Running progress is indeterminate because neither tool provides a percent-complete value.
- **Available actions.** Stop, Pause, and Resume use operating system signals when the app finds a real process. You can also open a terminal and create or open a pull request.
- **Read-only changes.** View Diff is only a read-only, point-in-time `git status --short` snapshot.
- **Disabled actions.** Retry, Approve, and Reject are disabled. The app has no stdin or terminal control channel for sessions that started outside the app.
- **Fast navigation.** Press `Cmd/Ctrl+K` to search sessions, projects, and branches. Use it to open details, run an available action, or change display settings, and press `/` to focus the table search.
- **Saved local settings.** Theme, density, columns, filters, and sorting stay on the same device after a reload. The app validates and versions this local data before it uses it.
- **Accessibility checks.** The interface uses semantic HTML and keyboard navigation. Automated checks cover the dashboard, the detail panel, and light and dark contrast.

## Quick Start

### Requirements

- Node.js 24, as listed in `.nvmrc`
- pnpm 11 through Corepack
- macOS
- [Codex CLI](https://github.com/openai/codex) and/or [Claude Code](https://claude.com/claude-code), used at least once

Process discovery uses `ps` and `lsof`. Reading Codex data also uses the `sqlite3` command-line tool.

### 1. Install

```bash
corepack enable
pnpm install
```

### 2. Run

```bash
pnpm dev
```

### 3. Open

Open the local address printed in the terminal. The default address is `http://127.0.0.1:3000`.

The dashboard uses the real local session data on your machine. There is no seed data to load and nothing else to configure.

## How it works

### Architecture

```text
src/
  app/                 Next.js App Router: pages + API route handlers
  domain/              Zod schemas + inferred types: the shared data shapes
  data-access/         Codex adapter, Claude Code adapter, mock adapter, command execution
  lib/query/           Normalized TanStack Query cache + realtime event reducer
  lib/realtime/        SSE transport: reconnect, backoff, sequence-gap detection
  lib/settings/        localStorage-backed saved UI settings
  features/dashboard/  App shell, operations table, detail panel, command palette
```

Zod is a library that checks data shapes. A normalized cache stores each session once by its ID.

### Data flow

1. The browser gets the first snapshot from `GET /api/dashboard/snapshot`.
2. The server polls the local sources and compares each new snapshot with the last one. It sends changes through `GET /api/dashboard/events`. This SSE connection reconnects with backoff and resyncs after a sequence gap.
3. A reducer applies each update to the TanStack Query cache. An update for one session keeps references for other sessions unchanged.
4. Commands use HTTP POST requests. The routes are `POST /api/agents/[agentId]/actions` and `POST /api/agents/bulk-actions`.

The interface uses [Astryx](https://astryx.atmeta.com) with its Neutral theme. The main table uses TanStack Table and TanStack Virtual. Temporary interface state stays in React state. Saved settings use a `useSyncExternalStore`-backed localStorage hook.

## Scripts

| Script             | What it does                                                               |
| ------------------ | -------------------------------------------------------------------------- |
| `pnpm dev`         | Start the development server with Turbopack on `127.0.0.1`.                |
| `pnpm build`       | Create a production build.                                                 |
| `pnpm start`       | Start the production build on `127.0.0.1`.                                 |
| `pnpm typecheck`   | Run `tsc --noEmit`.                                                        |
| `pnpm lint`        | Run ESLint with the flat config.                                           |
| `pnpm test:vitest` | Run unit and component tests with Vitest and React Testing Library.        |
| `pnpm test:e2e`    | Run Playwright end-to-end tests, including accessibility checks.           |
| `pnpm astryx`      | Open the Astryx command-line tools for component docs, tokens, and themes. |

## Security model

This is a local tool for one user. It is not a service for many users. It has no login, accounts, roles, or cloud backend.

- The server binds only to `127.0.0.1`. It does not bind to `0.0.0.0`.
- Each API request must use the canonical local `Host`. If the request has an `Origin`, it must match that exact local origin.
- Commands use `execFile` with an array of arguments. They do not build shell commands from strings.
- Claude transcript paths must stay inside configured canonical roots. Log paths and action working directories come from the current snapshot. The app checks action working directories again before use.
- Zod validates every request body before handler logic uses it.
- Request bodies have a size limit.

## Known limitations

- **macOS only.** Process discovery depends on `ps` and `lsof`.
- **No progress percentage.** Neither source provides a percent-complete value. Running progress is indeterminate. Completed progress is full.
- **Codex cost is always `—`.** The local Codex state has no pricing data.
- **Process control needs a matched process.** Claude Code sessions often have no reliable operating system process match. Stop, Pause, and Resume are available only when the app sees a real process.
- **Signals can affect more than one process.** Stop, Pause, and Resume can affect all processes that share the target working directory.
- **Retry, Approve, and Reject do not work.** They stay disabled because there is no control channel for sessions started outside the app.
- **View Diff is a snapshot.** It is a read-only `git status --short` result from one point in time.
- **Logs are bounded.** The detail panel reads only a limited tail of each source transcript.

## License

This repository has no license file. Treat it as all rights reserved until a license is added.
