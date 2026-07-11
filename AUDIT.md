# Production-readiness audit

Audit date: 2026-07-11 KST  
Audited revision: 75f9659 plus the uncommitted fixes described below  
Environment: Darwin 25.3.0 arm64, Node v24.13.0, pnpm 11.11.0, sqlite3 3.51.0  
Scope: all tracked source under src, API routes, tests, runtime scripts, and the README claims named in the request  
Status: BLOCKED only by the managed-sandbox batch Playwright launcher; product gates and isolated live QA are otherwise green

## Baseline and method

The supplied baseline was accepted without redundant re-validation: typecheck and build passed, lint passed with one TanStack/React-Compiler warning, Vitest passed 192/192, and Playwright passed 15/15. The audit therefore focused on logic, security boundaries, process identity, concurrency, resource bounds, honest degradation, and edge cases.

The source inventory and every named high-risk area were inspected with text and AST-aware searches, caller tracing, focused runtime fixtures, and independent read-only review lanes. CodeGraph was unavailable in this environment and LSP calls were cancelled by the tool surface, so semantic claims were verified with caller search, TypeScript, Vitest, and binding reviewers. No test accessed or modified the real CODEX_HOME or CLAUDE_CONFIG_DIR, and no test signalled a live process.

Pre-final integration receipt: pnpm typecheck exited 0; pnpm test:vitest passed 32 files and 331/331 tests.

## Final gate receipts

| Gate | Exact command | Result | Evidence |
|---|---|---|---|
| TypeScript | pnpm typecheck | PASS | Exit 0; tsc --noEmit emitted no diagnostics |
| ESLint | pnpm lint | PASS | Exit 0; zero errors and zero warnings. The prior TanStack warning has one scoped WHY suppression; config is unchanged |
| Vitest | pnpm test:vitest | PASS | 32 files, 333/333 tests. jsdom retained its non-failing canvas/scrollTo environment diagnostics |
| Production build | pnpm build | PASS | Next.js 16.2.10 compiled, typechecked, generated 3 static pages, and emitted all five API routes |
| Playwright | pnpm test:e2e | ENVIRONMENT BLOCKED | Dev watcher hit EMFILE; production-server retries reached Chromium but macOS denied MachPortRendezvous/LaunchServices/CVDisplayLink inside the managed sandbox. All 15 unchanged test bodies passed one-per-browser; this fallback is not represented as a green batch gate |

## Manual QA receipts

| Scenario | Expected | Result | Evidence and cleanup |
|---|---|---|---|
| GET /api/dashboard/snapshot | 200, no-store, schema-valid snapshot | PASS | 1,948-byte response; DashboardSnapshotSchema parsed fixture IDs audit-codex and claude_code:audit-claude; SHA-256 8926bd716386323cf2222356225579b34600768b8e9ca4ddb5c4549244d20dba |
| GET /api/dashboard/events | SSE frame, disconnect cleanup, concurrent clients isolated | PASS | Two clients each received sequences 0-3 (2,442 bytes); ESTABLISHED was present during streaming and absent after disconnect; server remained healthy |
| Host and Origin attacks | 403 without internal disclosure | PASS | Foreign Host and cross-port Origin both returned 403; bodies were 66 and 77 bytes |
| Malformed, wrong-media-type, and oversized bulk body | Bounded 4xx/413 before repository action | PASS | text/plain 415; malformed body 400; 101 IDs 400; 70 KiB body 413; bodies were 46-64 bytes and only retry was used |
| Server and fixture teardown | Owned PID gone, selected port free, temporary homes removed | PASS | Owned server PID 49939 exited; lsof found no port 4198 socket; temp CODEX_HOME, CLAUDE_CONFIG_DIR, fake ps/lsof, and workspace were removed |

## FIXED findings — local adapter, SQLite, processes, and Codex logs

| ID | Severity | Location | Confirmed defect and resolution | Regression |
|---|---|---|---|---|
| L-01 | P1 | src/data-access/local-adapter.ts:515-570; src/domain/agent/agent.ts:39 | PID 0 and argv text containing codex could be accepted. Only positive PIDs whose executable basename is codex are now accepted. | src/data-access/local-adapter.test.ts:169,175; src/domain/agent/agent.test.ts:46 |
| L-02 | P1 | src/data-access/local-adapter.ts:1363-1407 | A cached PID could be reused before a signal. PID, executable identity, and canonical cwd are refreshed immediately before the mocked signal boundary. | src/data-access/local-adapter.test.ts:188 |
| L-03 | P1 | src/data-access/local-adapter.ts:1372-1390,1561 | Shared or duplicate PIDs could be signalled repeatedly. A command/bulk-scoped handled-PID set claims each PID once. | src/data-access/local-adapter.test.ts:206,223 |
| L-04 | P2 | src/data-access/local-adapter.ts:197-208 | sqlite3, ps, lsof, open, git, and gh children could hang indefinitely. The common exec boundary now applies a 5-second timeout and 8 MiB maxBuffer. | src/data-access/local-adapter.test.ts:242,249 |
| L-05 | P2 | src/data-access/local-adapter.ts:207,1519 | gh could block on an interactive prompt. GH_PROMPT_DISABLED=1 is passed to gh. | src/data-access/local-adapter.test.ts:264 |
| L-06 | P2 | src/data-access/local-adapter.ts:1319-1340 | A hung/rejected snapshot build could retain snapshotInFlight. The timeout rejects and finally always releases the shared promise for retry. | src/data-access/local-adapter.test.ts:252 |
| L-07 | P3 | src/data-access/local-adapter.ts:212-225 | A state DB disappearing between readdir and stat aborted discovery of valid peers. Candidate-local ENOENT is skipped. | src/data-access/local-adapter.test.ts:473 |
| L-08 | P2 | src/data-access/local-adapter.ts:299-310,408 | SQLite dynamic TEXT in any selected thread/edge field, including nominal numeric columns, could exceed maxBuffer. Every emitted value is cast and capped at 4,096 characters. | src/data-access/local-adapter.test.ts:773,785,800 |
| L-09 | P2 | src/data-access/local-adapter.ts:415-442 | Thread or edge IDs longer than AgentIdSchema allowed could poison the client snapshot. Invalid records are rejected at the adapter boundary. | src/data-access/local-adapter.test.ts:509 |
| L-10 | P3 | src/data-access/local-adapter.ts:159 | A finite numeric timestamp outside the JavaScript Date range failed later in toISOString. Converted timestamps are range-checked. | src/data-access/local-adapter.test.ts:461 |
| L-11 | P3 | src/data-access/local-adapter.ts:1319-1321 | A backward wall-clock jump made a negative cache age look fresh. Cache hits now require a non-negative age. | src/data-access/local-adapter.test.ts:491 |
| L-12 | P2 | src/data-access/local-adapter.ts:581-603 | A rollout leaf swapped to a symlink or FIFO after snapshot creation could escape or block. Opens use O_NOFOLLOW and O_NONBLOCK and validate the opened handle with fstat().isFile(). | src/data-access/local-adapter.test.ts:568,581 |
| L-13 | P2 | src/data-access/local-adapter.ts:592-600 | Tail reads dropped an exact-boundary complete record and returned a lone mid-record fragment with no newline. A preceding-byte check preserves complete records and discards partial fragments. | src/data-access/local-adapter.test.ts:534,557 |
| L-14 | P2 | src/data-access/local-agent-logs.ts:99-106 | Direct log reads swallowed real I/O failures as empty logs. User-requested reads now propagate errors; snapshot enrichment alone degrades locally. | src/data-access/local-agent-logs.test.ts:175; src/data-access/local-adapter.test.ts:546 |
| L-15 | P3 | src/data-access/local-adapter.ts:632-648,800 | task_started and event_msg/error evidence was ignored, losing running/failed state. Only observed events are now incorporated into classification. | src/data-access/local-adapter.test.ts:407,441,451 |
| L-16 | P3 | src/data-access/local-agent-logs.ts:43-82 | Same-timestamp Codex log IDs were assigned after limiting and changed when the tail window moved. IDs are assigned before slicing. | src/data-access/local-agent-logs.test.ts:152 |
| L-17 | P3 | src/data-access/local-adapter.ts:1505-1513 | git diff --stat omitted staged and untracked files; an initial trim() fix also corrupted porcelain leading status columns. The read-only action now returns exact git status --short output using trimEnd(). | src/data-access/local-adapter.test.ts:278-295 |

## FIXED findings — Claude discovery, JSONL, IDs, and pricing

| ID | Severity | Location | Confirmed defect and resolution | Regression |
|---|---|---|---|---|
| C-01 | P1 | src/data-access/claude-code-adapter.ts:578-679 | Project and transcript candidates lacked canonical containment and regular-file checks. Roots, projects, and leaves are canonicalized/contained and opened as regular files. | src/data-access/claude-code-adapter.test.ts:245,257 |
| C-02 | P2 | src/data-access/claude-code-adapter.ts:45,135-175,399-435 | Transcripts and sessions-index.json were read without byte ceilings. Transcripts are capped at 64 MiB and indexes at 8 MiB; incomplete reads never produce partial token/cost data. | src/data-access/claude-code-adapter.test.ts:289,312 |
| C-03 | P2 | src/data-access/claude-code-adapter.ts:777-784 | Concurrent scans duplicated index reads and warnings. The in-flight Promise, rather than only its result, is cached per project. | src/data-access/claude-code-adapter.test.ts:325 |
| C-04 | P3 | src/data-access/claude-code-adapter.ts:415; src/data-access/claude-code-logs.ts:30 | Leading-whitespace JSONL was discarded. Input is trimStart()-filtered; malformed/truncated records and unknown future fields still degrade safely. | src/data-access/claude-code-adapter.test.ts:338; src/data-access/claude-code-logs.test.ts:12 |
| C-05 | P1 | src/data-access/claude-code-adapter.ts:630,721 | Equal raw Codex and Claude session IDs collapsed during merge. Claude public IDs are namespaced with claude_code:. | src/data-access/claude-code-adapter.test.ts:347 |
| C-06 | P2 | src/data-access/claude-code-adapter.ts:631-632 | A valid long filename plus the namespace could exceed the 256-character AgentId contract. Final public IDs are validated and invalid sessions are skipped with a warning. | src/data-access/claude-code-adapter.test.ts:356 |
| C-07 | P1 | src/data-access/claude-code-adapter.ts:66,303,448,717 | Unsafe numeric counters and aggregate overflow emitted schema-invalid tokens or non-finite costs. Safe integers and finite aggregates are required; invalid sessions warn and skip. | src/data-access/claude-code-adapter.test.ts:141,168,369 |
| C-08 | P1 | src/data-access/claude-code-adapter.ts:489-524 | Cache-creation aggregate and 5m/1h buckets could disagree in either direction, producing zero or partial invented cost. Exact equality is required or cost is null. | src/data-access/claude-code-adapter.test.ts:101,108 |
| C-09 | P2 | src/data-access/local-adapter.ts:1250-1252 | A summary added known Claude costs even when another Claude session was unpriced, presenting a partial total as complete. Any unknown Claude cost makes the aggregate null; Codex null remains intentionally excluded. | src/data-access/local-adapter.test.ts:597,615 |
| C-10 | P3 | src/data-access/claude-code-logs.ts:63 | Same-timestamp Claude log IDs changed with the limit window. IDs are assigned before slicing. | src/data-access/claude-code-logs.test.ts:20 |
| C-11 | P2 | src/data-access/claude-code-adapter.ts:135,663,807 | Non-regular, oversized, unreadable, or corrupt Claude inputs were silently omitted. Bounded aggregate warnings now preserve data-completeness honesty. | src/data-access/claude-code-adapter.test.ts:228,257,312,325 |

## FIXED findings — API request and authorization boundaries

| ID | Severity | Location | Confirmed defect and resolution | Regression |
|---|---|---|---|---|
| A-01 | P1 | src/lib/security.ts:9-10,61-99 | Origin was compared only by hostname, allowing another loopback port to send a destructive simple POST. A present HTTP Origin must exactly equal the request origin. | src/lib/security.test.ts:46,57,71 |
| A-02 | P2 | src/lib/security.ts:27-59 | Bracket suffixes, empty ports, multiple colons, and numeric loopback aliases could pass Host parsing. Only canonical localhost or 127.0.0.1 authorities are accepted. | src/lib/security.test.ts:21,35 |
| A-03 | P1 | src/lib/security.ts:87-128 | Write routes accepted text/plain JSON and unbounded chunked bodies. Shared parsing requires application/json and enforces a 64 KiB streaming limit. | src/lib/security.test.ts:84; actions/route.test.ts:41,54; bulk-actions/route.test.ts:34,47 |
| A-04 | P1 | src/domain/agent/actions.ts:40-48; src/domain/agent/agent.ts:4-6,39-41 | Bulk arrays, duplicates, ID lengths, and runtime PIDs were insufficiently bounded. IDs are 1-256 chars, bulk is 1-100 unique IDs, and PIDs are positive. | src/domain/agent/actions.test.ts:6-39; src/domain/agent/agent.test.ts:46 |
| A-05 | P2 | actions/route.ts:28-36; logs/route.ts:24-32; bulk-actions/route.ts:31 | Route IDs bypassed the shared schema and constructor/toString/__proto__ passed inherited-property membership checks. IDs are parsed and membership uses Object.hasOwn. | actions/route.test.ts:83,98; logs/route.test.ts:48,63; bulk-actions/route.test.ts:78 |
| A-06 | P2 | actions/route.ts:22; logs/route.ts:18; bulk-actions/route.ts:22 | Raw Zod issues exposed internals and amplified a 15,031-byte malformed body into about 774 KiB. Invalid inputs now return fixed bounded public errors and never call repositories. | actions/route.test.ts:67; logs/route.test.ts:32; bulk-actions/route.test.ts:60 |

## FIXED findings — SSE, realtime recovery, and optimistic state

| ID | Severity | Location | Confirmed defect and resolution | Regression |
|---|---|---|---|---|
| R-01 | P1 | events/route.ts:126; domain/realtime/events.ts:36; lib/query/reducer.ts:93 | New projects were never sent during an uninterrupted SSE session. projects_updated was added end to end. | events/route.test.ts:54; events.test.ts:29; reducer.test.ts:7 |
| R-02 | P2 | src/domain/realtime/events.ts:13-43 | entityId and payload.id could disagree and corrupt normalized keys. The event schema enforces equality. | src/domain/realtime/events.test.ts:45,64 |
| R-03 | P1 | src/lib/query/use-realtime-sync.ts:176 | The first successful SSE open skipped authority reconciliation, retaining entities deleted before connection. Every open now schedules recovery. | src/lib/query/use-realtime-sync.test.tsx:149 |
| R-04 | P1 | src/lib/query/use-realtime-sync.ts:48-58; dashboard-root.tsx:90-100 | A background refetch error disconnected realtime or replaced valid cached UI with a fatal screen. Connection/rendering is gated on data presence, not success status alone. | use-realtime-sync.test.tsx:132; dashboard-root.test.tsx:109 |
| R-05 | P1 | src/lib/query/use-realtime-sync.ts:87-151 | Stale buffered events or an older refetch could overwrite a newer authoritative snapshot. Pre-recovery buffers are discarded and arrivals during recovery schedule a serialized trailing authority pass. | src/lib/query/use-realtime-sync.test.tsx:163,192 |
| R-06 | P2 | src/lib/query/use-realtime-sync.ts:103-132 | Failed recovery could stop forever and events could grow without bound. Recovery retries after one second and backlog is capped at 512 before forcing authority. | src/lib/query/use-realtime-sync.test.tsx:216,241 |
| R-07 | P3 | src/lib/query/use-realtime-sync.ts:140 | A later sequence carrying an older timestamp moved lastEventAt backward. Only a newer parsed time is accepted. | src/lib/query/use-realtime-sync.test.tsx:262 |
| R-08 | P1 | src/lib/query/use-agent-action.ts:50-157 | A failed optimistic action restored a stale whole snapshot, deleting unrelated/newer state. Rollback is target-local and identity/provenance guarded. | src/lib/query/use-agent-action.test.tsx:117,156,190 |
| R-09 | P1 | src/lib/query/use-agent-action.ts:14-157 | Concurrent actions left summary counts inconsistent, and same-agent pause/resume failures could leave a failed layer cached. Count provenance is tracked and only one unresolved optimistic layer per agent is applied while both API calls remain allowed. | src/lib/query/use-agent-action.test.tsx:81,216,244 |
| R-10 | P2 | src/lib/realtime/sse-transport.ts:91-203 | open/error flapping reset reconnect backoff without receiving data. Backoff resets only after inbound liveness; disconnect clears reconnect and stale timers. | src/lib/realtime/sse-transport.test.ts:81,97,124 |

## FIXED findings — settings, dashboard, UI, and documentation honesty

| ID | Severity | Location | Confirmed defect and resolution | Regression |
|---|---|---|---|---|
| U-01 | P3 | src/domain/settings.ts:61; use-persisted-settings.ts:18 | Invalid/missing storage returned a shared mutable default. Each fallback is cloned. | src/domain/settings.test.ts:39; use-persisted-settings.test.ts:41 |
| U-02 | P2 | src/domain/settings.ts:25-37 | Persisted width, filter, and sorting values were unbounded. Values and collection lengths are constrained to the finite table surface. | src/domain/settings.test.ts:54,64,77,93 |
| U-03 | P2 | src/lib/settings/use-persisted-settings.ts:84-120 | Cross-tab updates and quota failures could overwrite newer storage or the in-memory failed-write patch. Updates merge current storage plus the retained patch until a write succeeds. | use-persisted-settings.test.ts:90,109,124 |
| U-04 | P2 | src/features/dashboard/table/use-table-state.ts:133-196 | External settings did not reconcile, unrelated updates canceled pending resizes, key order caused false changes, and an external width marker suppressed a later genuine local return to that width. Slices use semantic comparison and the external echo is consumed once. | use-table-state.test.ts:12,61,80,127 |
| U-05 | P2 | src/features/dashboard/dashboard-root.tsx:90-100 | An initial snapshot error was hidden behind the spinner. Data-less errors render first; cached-data refetch errors retain the workspace. | src/features/dashboard/dashboard-root.test.tsx:97,109 |
| U-06 | P2 | src/features/dashboard/dashboard-root.tsx:40-124 | Top counters, project navigation, and persisted filters used divergent state. They now share persisted filters and reconcile external changes without write-back loops. | src/features/dashboard/dashboard-root.test.tsx:126,140,154,162 |
| U-07 | P1 | src/features/dashboard/table/operations-table.tsx:218-342 | Row and bulk Stop reached SIGTERM without the existing impact confirmation. Both reuse the Astryx AlertDialog; cancel sends nothing and confirmation captures the intended IDs. | src/features/dashboard/table/operations-table.test.tsx:216,240,254 |
| U-08 | P3 | src/features/dashboard/detail-panel/logs-tab.tsx:91-152 | Clipboard rejection became an unhandled promise and showed no feedback. Rejections are handled and the existing Banner reports failure. | src/features/dashboard/detail-panel/logs-tab.test.tsx:82 |
| U-09 | P2 | src/features/dashboard/detail-panel/logs-tab.tsx:52-91 | Out-of-order copy completions and agent changes leaked stale feedback. Attempt and agent identity gate every completion. | src/features/dashboard/detail-panel/logs-tab.test.tsx:96,119,136 |
| U-10 | P3 | src/features/dashboard/detail-panel/changes-tab.tsx:16-115; README.md:16-21,87-89 | The UI/docs claimed git diff --stat, pagination, every-request guards, and universal canonicalization that the implementation did not provide. Copy now accurately describes tail bounds, every API request, actual path controls, and a point-in-time read-only git status --short view. | src/features/dashboard/detail-panel/detail-panel.test.tsx:197 |
| U-11 | P3 | src/features/dashboard/table/operations-table.tsx:144-146 | The known react-hooks/incompatible-library warning was left implicit. A narrowly scoped WHY comment suppresses only TanStack Table’s documented non-memoizable return; ESLint config is unchanged. | pnpm lint, final receipt pending |

## DEFERRED findings

| ID | Severity | Location | Item | Reason |
|---|---|---|---|---|
| D-01 | P3 | events/route.ts:44-67,204 | SSE client cap and explicit queue backpressure | No reachable loopback leak/exhaustion was reproduced; a cap is an operational policy decision. |
| D-02 | P3 | events/route.ts:185-191 | Abort during the initial snapshot still completes one repository read | Enqueue/timer installation is prevented and cleanup succeeds; the repository has no cancellable API. |
| D-03 | P3 | sse-transport.ts:174; events/route.ts:13 | Named-listener removal on a closed EventSource | Current server emits only event: message, so the named-listener path is unreachable under the current contract. |
| D-04 | P3 | use-persisted-settings.ts:120; sse-transport.ts:194 | StrictMode duplicate storage writes or synchronous-disconnect dead timer | No user-visible corruption or retained timer was reproduced in current call paths. |
| D-05 | P3 | operations-table.tsx:235,342 | Extend confirmation from Stop to Pause/Resume | Different risk semantics require product/UX policy; Stop is the confirmed destructive gap. |
| D-06 | P3 | dashboard-root.tsx:86,123 | Exact Incidents navigation/filter semantics | The required product behavior is ambiguous; no speculative UI change was made. |
| D-07 | P3 | claude-code-adapter.ts:578-638 | Ancestor openat pinning, hard-link policy, and full traversal budget | Current canonical containment, leaf nofollow, regular-file, and byte limits are enforced. The remaining platform-specific redesign lacks a bounded current-contract fix. |
| D-08 | P3 | local-adapter.ts:1379-1407 | PID reuse between the final cwd observation and process.kill | macOS lacks the pidfd-style identity handle needed to eliminate this final syscall window. The window is minimized by immediate fresh identity/cwd checks. |
| D-09 | P2 | src/features/dashboard/shell/top-bar.tsx:41 | The 375px mobile header measures 392px and wraps 연결됨 vertically | Both independent visual reviewers confirmed the existing issue. Choosing which top-nav information to collapse is a design policy change expressly outside this audit; 768px and 1280px fit exactly. |
| D-10 | P3 | src/features/dashboard/detail-panel/agent-actions.tsx:40-41 | The shared Korean Stop explanation can break between 세션 and 과 in the 400px dialog | Meaning, danger, and accessibility remain intact. The new table path correctly reuses the existing copy; wording/line-break redesign is deferred. |

## WONTFIX and design limitations

| ID | Severity | Location | Item | Decision |
|---|---|---|---|---|
| W-01 | P2 | local-adapter.ts:1358-1426 | A signal applies to all verified Codex processes sharing the cwd | No reliable session-to-PID mapping exists. Fresh identity/cwd checks, dedupe, truthful impact copy, and Stop confirmation bound the risk without fabricating precision. |
| W-02 | P3 | local-adapter.ts:112,1495,1519 | Local child-process diagnostics appear in action results | These are loopback-only operational diagnostics behind exact authority, media-type, and agent allowlists; they remain useful and have no demonstrated remote path. |
| W-03 | P3 | claude-pricing.ts:4-27 | Freshness of the externally published rate table | Explicitly reserved for the CTO. This audit covers internal per-MTok arithmetic, cache-breakdown consistency, and unknown-model fallback only. |

## Reviewed and found sound or refuted

| Audit area | Result | Evidence |
|---|---|---|
| SQL value escaping | Sound | local-adapter.ts:265 doubles single quotes; only cwd enters as a value literal. |
| Dynamic SQL identifiers and UNION assembly | Refuted as injection path | selectedColumn and aliases come only from code constants at local-adapter.ts:321,328,362. |
| SQLite read-only mode | Sound | local-adapter.ts:243 always invokes sqlite3 with -readonly and -json. |
| Missing/old sqlite3 and query errors | Honest degradation | local-adapter.ts:465,494 returns compatible empty data plus warnings; timeout/maxBuffer are bounded. |
| resolveWorkingDirectory and action path ownership | Sound after fixes | Routes check snapshot membership; repositories re-resolve the agent; local-adapter.ts:1444 realpaths and validates a directory; signals additionally recheck current process cwd. |
| Negative and NaN PID reachability | Refuted | The process regex accepts digits only and both parser/domain require positive integers. |
| SSE abort, cancel, poll overlap, and multi-client cleanup | Sound | Idempotent cleanup at events/route.ts:168-210 clears timers/listeners/stream; ticking plus catch/finally prevents overlap and rejection leaks; route tests cover abort and isolation. |
| All five API guards | Sound | snapshot route:10, events route:36, action route:12, logs route:12, bulk route:12. |
| IPv6 ::1 policy | Consistent | package scripts bind only IPv4 127.0.0.1; the guard intentionally accepts only canonical localhost/127.0.0.1. |
| JSONL truncation and future fields | Sound after fixes | Codex and Claude readers skip malformed/truncated records and ignore unknown fields without inventing data. |
| Claude pricing units and unknown models | Sound internally | Per-MTok values divide by 1,000,000; billed unknown models return null; zero-token unknown records do not invent cost. |
| EventSequencer classification | Sound | Duplicate, stale, gap, and reset decisions remain distinct; consumer recovery is regression-tested. |
| Reducer reference preservation | Sound | Only changed slices are copied; heartbeat/no-op retains the original object; project-event tests check sibling identity. |
| Mock adapter production reachability | Refuted | repositories.ts wires only real local repositories; mock-adapter imports are test-only and no environment selector exists. |
| Environment-variable switching | Sound | CODEX_HOME and CLAUDE_CONFIG_DIR select local roots only; neither switches to mock data. |
| Normal epoch second/millisecond conversion | Sound | Existing heuristic is consistent for normal ranges; only out-of-Date-range values were rejected. |
| snapshotInFlight normal concurrency | Sound | Concurrent calls share one Promise and finally releases it on success or failure. |
| Client timer cleanup | Sound | Realtime flush/retry, EventSource reconnect/stale, and table debounce timers have cleanup paths and focused tests. |
| Unhandled promises | Sound after fixes | SSE work catches internally, recovery handles rejection, and clipboard failures are caught. |
| Observer honesty | Preserved | retry/approve/reject remain explained skips; Codex cost remains null; no progress or cost is fabricated. |

## Review and scope receipts

- Seven disjoint executor increments captured defect-specific RED before production changes.
- Seven binding code-review scopes reached unconditional PASS after remediation loops: API/security; local process/SQLite/logs; Claude readers/pricing; realtime server/domain; realtime client/query; settings/dashboard; UI safety.
- Additional whole-diff scope review found and locked the one-shot column-width echo and exact git porcelain leading-column defects.
- Two independent visual reviewers passed the changed Stop confirmation and clipboard error surfaces; both recorded the pre-existing 375px header issue as deferred.
- No dependency, pnpm-lock, package/config, .git, .serena, .agents, or .codex change is in the diff.
- No new UI component, CSS redesign, fabricated progress, estimated Codex cost, or expanded control channel was introduced.

## Final decision

BLOCKED on one external condition: the exact pnpm test:e2e batch cannot keep Chromium alive inside this managed macOS sandbox. The failure occurs before or between test pages in Chromium platform services, not in an application assertion; a one-page launch toggle and all 15 unchanged tests run one-per-browser pass. TypeScript, ESLint, Vitest, build, curl QA, cleanup, and changed-surface visual QA are green. The final five-lane and whole-artifact reviews remain to be recorded below before handoff.
