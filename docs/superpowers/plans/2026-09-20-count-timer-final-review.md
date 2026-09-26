# Count Timer Final Review Findings Implementation Plan

> **Lease behavior amendment (2026-09-26):** The product decision now requires timers to continue when the last tab closes or a lease expires. The pause-on-last-lease requirements below are historical and superseded by the design spec.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task uses TDD and ends with focused verification.

**Goal:** Close the five final whole-branch findings around bootstrap security, lease presence, authoritative command recovery, alarm retry epochs, and delayed tab opens.

**Architecture:** Preserve the existing route helpers, transaction boundaries, and client hook APIs while adding the smallest explicit state needed for empty bootstrap bodies, lease readiness, command target proof, retry epochs, and tab-open generations. Server regressions stay in the existing integration suites; browser timing regressions use the existing Playwright mock transport.

**Tech Stack:** Next.js 16 route handlers, TypeScript, PostgreSQL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-count-timer-v1-design.md`

## Global Constraints

- Mutating requests must match `APP_ORIGIN` exactly.
- Bootstrap accepts the browser’s normal empty POST and rejects non-empty bodies within a bounded read.
- A timer pauses at the last safe lease signal when no active lease remains; reopening never resumes it automatically.
- Commands use explicit targets and never retry an unknown toggle after timeout.
- Accepted read, heartbeat, and pageshow snapshots advance alarm retry epochs; the claim reconciliation read does not.
- Delayed opens are generation- and tab-id-safe and stale leases are closed after their response arrives.
- Do not touch deployment documentation.

## Review Focus

- A POST bootstrap with no body succeeds while an evil-origin, non-empty, and oversized request cannot create an identity.
- A closed or expired final lease pauses both timer kinds at a stored signal and a later open leaves them paused.
- A timed-out applied command becomes synced only after read-back proves the target; an unchanged read-back remains unsynced with one request.
- A failed alarm claim retries after a later heartbeat/pageshow snapshot but not from its own reconciliation read.
- A pagehide during a delayed open cannot activate the old lease after pageshow creates a fresh tab id.

### Task 1: Bootstrap boundary and lease invariant

**Files:** `src/app/api/bootstrap/route.ts`, `src/lib/server/http.ts`, `src/lib/server/leases.ts`, `tests/unit/http.test.ts`, `tests/integration/identity.test.ts`, `tests/integration/leases.test.ts`.

- [ ] Add RED unit and integration tests for empty-body acceptance, Origin enforcement, non-empty/oversized body rejection, zero-active-lease reconciliation, and paused reopen behavior.
- [ ] Run the focused unit/integration commands and record the expected failures before implementation.
- [ ] Implement bounded empty-body handling, bootstrap Origin validation, and zero-active-lease pause reconciliation at the maximum stored signal.
- [ ] Run focused tests to GREEN.

### Task 2: Lease readiness and generation-safe tab sync

**Files:** `src/hooks/tab-sync.ts`, `src/hooks/useTimers.ts`, `src/components/timer/TimerPage.tsx`, `tests/e2e/fixtures/timer-snapshots.ts`, `tests/e2e/network.spec.ts`.

- [ ] Add RED Playwright tests for controls disabled between bootstrap and open, and delayed open/pagehide/pageshow with distinct tab ids and stale close.
- [ ] Run the focused tests and observe the failures.
- [ ] Add explicit lease readiness, invalidate pending opens on pagehide, guard delayed responses by generation/tab id, and make pageshow open a fresh id.
- [ ] Run the focused browser tests to GREEN.

### Task 3: Command read-back proof

**Files:** `src/hooks/snapshot-guards.ts`, `src/hooks/useTimers.ts`, `tests/unit/snapshot-guards.test.ts`, `tests/e2e/network.spec.ts`, `tests/e2e/timer.spec.ts`.

- [ ] Add RED unit/browser regressions for applied and not-applied timeout reset and explicit start/pause commands, including pending state during the GET.
- [ ] Run the focused tests and observe the failures.
- [ ] Keep the command pending through read-back, prove target state plus a newer revision, and leave unsynced with an error when proof is absent without resending.
- [ ] Run focused tests to GREEN.

### Task 4: Alarm retry epochs

**Files:** `src/hooks/useTimers.ts`, `tests/e2e/network.spec.ts`.

- [ ] Add a RED heartbeat/pageshow retry regression and assert the claim reconciliation read does not produce an immediate second claim.
- [ ] Run the focused browser test and observe the failure.
- [ ] Advance the retry epoch from accepted read/heartbeat/pageshow snapshots and mark the reconciliation read as non-advancing.
- [ ] Run focused tests to GREEN.

### Task 5: Full verification and checkpoint

**Files:** source/tests from Tasks 1–4 only.

- [ ] Run unit, integration where the test database is available, focused and full E2E, lint, typecheck, and build.
- [ ] Inspect the final diff and status, then commit one coherent checkpoint.
- [ ] Report exact commands/results and residual environment limitations.
