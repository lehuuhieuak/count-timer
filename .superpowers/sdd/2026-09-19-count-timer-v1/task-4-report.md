# Task 4 report: lease, multiple tabs, and alarm permission

## Scope

Task 4 adds server-side presence leases and one-shot countdown alarm claims while preserving the Task 1–3 contracts and the existing reference documents. The implementation keeps the existing timer row as the serialization point. Presence actions, timer reads, and timer commands reconcile expired leases before returning or applying state.

## TDD evidence

### RED

I added the requested fake-clock integration tests before adding the Task 4 routes or lease/alarm modules. The exact requested command was run against the PostgreSQL test URL:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test' \
  npm run test:integration -- tests/integration/leases.test.ts tests/integration/alarms.test.ts
```

Vitest collected both files but failed because the requested production routes did not exist:

```text
FAIL tests/integration/alarms.test.ts
Error: Cannot find module '../../src/app/api/alarms/route'
FAIL tests/integration/leases.test.ts
Error: Cannot find module '../../src/app/api/tabs/route'
Tests no tests
```

This was the expected feature-missing RED state. The first database migration attempt was blocked by sandbox access to `127.0.0.1:55432`; the same command was then run with approved access to the real PostgreSQL test service. No fake database or in-memory replacement was used.

### GREEN

The focused suites passed after implementation:

```text
Test Files  2 passed (2)
Tests       11 passed (11)
```

The complete Task 2–4 integration run passed:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test' \
  npm run test:integration -- --reset \
  tests/integration/identity.test.ts \
  tests/integration/timers.test.ts \
  tests/integration/leases.test.ts \
  tests/integration/alarms.test.ts
```

```text
Test Files  4 passed (4)
Tests       26 passed (26)
```

The tests use explicit timestamps rather than sleeping. They cover:

- two active tabs, closing one tab, and closing the last tab;
- both timers continuing while one lease remains;
- disappearance without a close beacon;
- timeout followed by a late heartbeat;
- reopening with a new tab ID without adding absent time;
- a stale tab close that cannot close a newer tab ID;
- idempotent repeated close;
- countdown completion before the last close;
- countdown remaining time when the last close precedes completion;
- same-origin, cookie, body, status, and `no-store` behavior for both routes;
- a running or unknown run being denied an alarm claim;
- exactly one success from two concurrent claims for one completed run;
- a claimed run remaining completed but becoming ineligible for another claim.

## Implementation

`src/lib/server/leases.ts` defines the 90-second lease and the requested `touchTab` and `reconcilePresence` interfaces. Each operation locks the timer row before reading or changing browser tabs. Expired leases are reconciled before an `open` or `heartbeat`; when the last valid lease disappears, both running timers are paused at the latest stored signal. Expired rows are deleted only after that pause point has been selected. A close updates only the matching `(user_id, tab_id)` row and has no effect when repeated or when the ID is unknown.

`src/lib/server/timer-state.ts` centralizes row parsing, persistence, completion materialization, and pausing at an explicit timestamp. A countdown that reaches zero while a request observes it is stored as stopped with `completed_run_id` set. A countdown that reaches zero before a lease closes is evaluated at the last signal timestamp, so time absent after that signal is never added. The existing timer command transaction now reconciles presence before checking the expected revision, and `GET /api/timers` reconciles before returning a snapshot.

Migration `002_alarm_claim.sql` adds `timer_states.alarm_claimed`, and the migration runner now applies ordered numbered migrations idempotently. `claimAlarm` locks the timer row and performs:

```sql
UPDATE timer_states
SET alarm_claimed = TRUE
WHERE user_id = $1
  AND completed_run_id = $2
  AND alarm_claimed = FALSE
```

The returned row count is the grant. PostgreSQL therefore gives exactly one `true` result for concurrent claims, while a run that is still running, unknown, or already claimed gets `false`.

`POST /api/tabs` and `POST /api/alarms` require the identity cookie and exact configured origin, parse bounded JSON through the existing body reader, return `400` for invalid input, `401` for invalid identity, and set `Cache-Control: no-store` through the shared response helpers.

## Verification

The real PostgreSQL test database applied the new migration successfully:

```text
Migration 001_initial.sql already applied; nothing to do.
Applied migration 002_alarm_claim.sql.
```

A second migration run was idempotent:

```text
Migration 001_initial.sql already applied; nothing to do.
Migration 002_alarm_claim.sql already applied; nothing to do.
```

Other checks passed on the final tree:

```text
npm run test:unit  -> 4 files, 16 tests passed
npm run lint       -> exit 0
npm run typecheck  -> exit 0
npm run build      -> exit 0; /api/alarms and /api/tabs included
```

The test and build commands retain the repository's existing non-failing warnings about Vitest ESM syntax under the current package mode and Next's `useTypeScriptCli` experiment.

There is no `npm test` script in this repository; the unit and full integration scripts above are the available complete test commands and were run directly.

## Self-review

- Presence transactions lock the timer row before lease rows, matching the Task 3 command lock and preventing concurrent tab actions from independently deciding who is last.
- Lease expiry uses `last_seen_at_ms + 90_000` as the boundary and pauses at the latest stored signal, never at the later request/open time.
- A new tab ID can reopen after absence without reviving the paused timer or adding absence time.
- `completed_run_id` remains an auditably completed run after an alarm claim; `alarm_claimed` is the one-shot permission state.
- Resetting or changing countdown duration clears the prior completion marker, and starting an exhausted countdown creates a fresh run ID.
- Invalid user IDs are still derived only from the cookie; the new route bodies cannot select another user.
- The implementation is backend-only for Task 4. Client heartbeat scheduling, pagehide beacon wiring, BroadcastChannel behavior, and actual browser audio playback remain Task 5 work.

No unresolved correctness finding remains for the requested Task 4 scope. The only material limitation is the existing non-failing tooling warnings described above; no browser or production deployment check is part of this backend task.

## Fix round 1

### Findings reproduced in RED

I added three focused integration regressions before changing production code:

1. The first alarm request after a countdown naturally reaches zero, before a read or heartbeat materializes completion.
2. A tab close at signal time `4000` commits before the final close request for another tab arrives with `nowMs = 3000`.
3. A heartbeat at `5000` is followed by a late heartbeat at `3000`; the newer signal must remain authoritative, and a closed tab must reopen with `closed_at_ms = NULL` without losing that timestamp.

The focused RED command was run against real PostgreSQL:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test' \
  npm run test:integration -- --reset \
  tests/integration/leases.test.ts tests/integration/alarms.test.ts
```

Before the fix it produced four failures across 14 tests:

```text
claims a naturally completed run ... expected granted true, received false
rejects claims ... expected the already completed run to grant, received false
pauses at the maximum stored close signal ... expected 3000, received 2000
preserves the newest heartbeat ... expected startedAtMs 1000, received null
```

### Fix and GREEN

- `claimCompletedAlarm` now locks the timer row, materializes a naturally completed countdown at `Date.now()`, persists that state, and then performs the existing conditional `alarm_claimed = FALSE` update. Concurrent claimers still serialize on the timer row and exactly one can update the row.
- The final-close path queries the maximum `GREATEST(last_seen_at_ms, closed_at_ms)` signal across the user’s stored tab rows and pauses at the maximum of that value and the current close request timestamp.
- `open` and `heartbeat` upserts now use PostgreSQL `GREATEST(browser_tabs.last_seen_at_ms, EXCLUDED.last_seen_at_ms)` and still clear `closed_at_ms`, preserving monotonic timestamps and reopen behavior.

The focused fix-round suites now pass:

```text
Test Files  2 passed (2)
Tests       14 passed (14)
```

The complete final verification also passes:

```text
Task 2–4 integration: 4 files, 29 tests passed
Unit tests:           4 files, 16 tests passed
Lint:                 exit 0
Typecheck:            exit 0
Build:                exit 0
```

The fix round changed only Task 4 implementation/tests and this report. The pre-existing untracked `docs/` reference/spec material remains untouched.

## Fix round 2

### Finding reproduced in RED

I added a deterministic integration regression for the case where the only tab opens and starts a countdown at `1000ms`, sends no beacon or heartbeat, and the first alarm request arrives exactly at `91000ms`. The test freezes `Date.now()` with Vitest so the 90-second lease boundary is exact. It requires the claim to return `false` and the countdown to be stored paused at its `1000ms` signal with no completed run.

The focused RED command was run against real PostgreSQL:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test' \
  npm run test:integration -- --reset \
  tests/integration/leases.test.ts tests/integration/alarms.test.ts
```

The command collected 15 tests and failed only the new regression:

```text
does not claim a countdown after its only lease expires without a beacon
expected { granted: false }, received { granted: true }
```

The first elevated execution attempt timed out in automatic approval review before producing output; the retry ran the same command and captured the RED failure. No implementation change was made during that timeout.

### Fix and GREEN

`claimCompletedAlarm` now keeps the timer row lock, calls `reconcilePresenceInTransaction` first, persists any revision-changing pause or natural-completion materialization, and only then runs the conditional `alarm_claimed = FALSE` update. An expired final lease therefore pauses at its last signal and cannot grant an alarm based on absent time. An active lease still allows natural completion to materialize at the current server time, and concurrent claims still serialize on the same timer row.

The focused fix-round suites pass:

```text
Test Files  2 passed (2)
Tests       15 passed (15)
```

The final full verification passes:

```text
Task 2–4 integration: 4 files, 30 tests passed
Unit tests:           4 files, 16 tests passed
Lint:                 exit 0
Typecheck:            exit 0
Build:                exit 0
```

Self-review confirms the claim path preserves timer-row-first lock ordering, uses the same lease boundary as reads and tab signals, persists reconciliation before claiming, and retains the specified `claimAlarm(userId, runId)` interface. The fix round changed only Task 4 code/tests and this report; `docs/` remains untouched.
