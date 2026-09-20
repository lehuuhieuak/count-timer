# Task 2 report — PostgreSQL và danh tính ẩn danh

## Kết quả

Task 2 đã được triển khai với PostgreSQL migration, connection pool giới hạn, danh tính ẩn danh qua cookie, bootstrap nguyên tử user + timer, repository đọc `Snapshot`, HTTP boundary và môi trường integration PostgreSQL riêng.

Checkpoint commit: separate commit `feat: add PostgreSQL anonymous identity`.

The supplied files under `docs/` were preserved. No reference HTML, CSS, JavaScript, design spec, or Task 1 source was modified.

## TDD evidence

### Initial RED

I first added `tests/integration/identity.test.ts`, the integration Vitest configuration, the safe test runner, and `compose.test.yaml` without adding the requested production modules. After starting the isolated PostgreSQL service, this exact command was run:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:count_timer_test@127.0.0.1:55432/count_timer_test' \
  npm run test:integration -- tests/integration/identity.test.ts
```

The command failed before running tests because the requested route did not yet exist:

```text
FAIL tests/integration/identity.test.ts
Error: Cannot find module '../../src/app/api/timers/route'
Tests  no tests
```

This was the expected feature-missing RED state. The PostgreSQL container was healthy, so the failure was not being hidden by a missing database service.

### Cookie-renewal RED → GREEN

The authoritative spec requires a valid existing cookie to be renewed on bootstrap. After the first implementation, I tightened the integration assertion and reran the same test command. It failed with 4 passing tests and 1 failing test because the valid bootstrap response did not yet set a renewed cookie.

After changing the bootstrap route to reissue the same valid token with the one-year cookie lifetime, the command passed:

```text
Test Files  1 passed (1)
Tests  5 passed (5)
```

### Final integration verification

The test runner was run with its reset guard and the real PostgreSQL service:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:count_timer_test@127.0.0.1:55432/count_timer_test' \
  npm run test:integration -- --reset tests/integration/identity.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  5 passed (5)
```

The tests cover separate identities, valid-cookie reuse, invalid-cookie rejection, atomic default timer state, hash-only storage, bootstrap cookie flags and renewal, cache control, and 401 responses for missing or invalid cookies on the non-bootstrap timers route.

## Migration and PostgreSQL evidence

The service was started with:

```bash
docker compose -f compose.test.yaml up -d --wait
```

The first sandbox attempt could not access `/var/run/docker.sock`; rerunning the same command with approved Docker access pulled `postgres:16-alpine` and reported `Container count-timer-postgres-test-1 Healthy`. `psql` is not installed locally, so all database checks used the `pg` client from the project.

The empty test database was migrated with:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:count_timer_test@127.0.0.1:55432/count_timer_test' \
  node scripts/migrate.mjs --test
```

First run:

```text
Applied migration 001_initial.sql.
```

Second run:

```text
Migration 001_initial.sql already applied; nothing to do.
```

Direct schema inspection confirmed `anonymous_users`, `timer_states`, `browser_tabs`, and `schema_migrations`; `timer_states.user_id` is its primary key, `browser_tabs` has primary key `(user_id, tab_id)`, both foreign keys reference `anonymous_users`, `revision` is checked `>= 0`, and `duration_ms` is checked between `1000` and `359999000`.

The integration runner refuses an unsafe database name:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:count_timer_test@127.0.0.1:55432/count_timer' \
  npm run test:integration -- tests/integration/identity.test.ts
```

Result:

```text
Refusing to reset or test database "count_timer": the database name must end with _test.
```

It also refuses to fall back to a production `DATABASE_URL`:

```bash
DATABASE_URL='postgresql://production:secret@db.example.internal:5432/count_timer' \
  npm run test:integration -- tests/integration/identity.test.ts
```

Result:

```text
TEST_DATABASE_URL is required; production DATABASE_URL is never used for integration tests.
```

## Implementation details

- `anonymous_users.token_hash` stores a 32-byte SHA-256 digest in `BYTEA`; the raw 32-byte token is generated with `randomBytes(32)`, encoded only for the cookie, and never inserted or logged.
- User and initial timer rows are inserted inside one transaction. The initial snapshot is elapsed `0`, remaining/duration `1500000`, sound enabled, stopped, revision `0`, and a generated countdown run ID.
- All application SQL values use PostgreSQL parameters. The shared pool is bounded to 10 connections with idle and connection timeouts.
- PostgreSQL `BIGINT` values are parsed through `BigInt` and rejected when negative where invalid or outside JavaScript’s safe integer range before becoming a `Snapshot` number.
- Bootstrap uses `HttpOnly`, `SameSite=Lax`, `Path=/`, HTTPS-derived `Secure`, and a one-year `Max-Age`; valid bootstrap requests renew the existing cookie.
- Non-bootstrap requests require an existing cookie and return 401 for missing or invalid identity; they never create a new user.
- Responses use `Cache-Control: no-store`, and database failures are returned without exposing connection details.

## Baseline validation before fix round 1

All of these checks passed on the final implementation:

```bash
npm run test:unit
npm run lint
npm run typecheck
npm run build
TEST_DATABASE_URL='postgresql://count_timer_test:count_timer_test@127.0.0.1:55432/count_timer_test' \
  npm run test:integration -- --reset tests/integration/identity.test.ts
```

Results were 13/13 Task 1 unit tests, 5/5 Task 2 integration tests, successful lint, successful Next type generation plus TypeScript checking, and a successful production build.

## Files added or changed

- `.env.example`
- `compose.test.yaml`
- `db/migrations/001_initial.sql`
- `scripts/migrate.mjs`
- `scripts/test-integration.mjs`
- `src/app/api/bootstrap/route.ts`
- `src/app/api/timers/route.ts`
- `src/lib/server/db.ts`
- `src/lib/server/http.ts`
- `src/lib/server/identity.ts`
- `src/lib/server/repository.ts`
- `tests/integration/identity.test.ts`
- `vitest.integration.config.ts`
- `package.json` and `package-lock.json` for `pg`, `@types/pg`, and `test:integration`

## Self-review

The Task 2 requirements are covered by implementation and integration evidence. No critical or important findings remain. The test commands emit an existing Vitest warning about ESM syntax in `vitest.config.ts` while the package defaults to CommonJS, and `next build` reports the existing experimental `useTypeScriptCli` setting; both were already present in the accepted Task 1 checkpoint and do not cause a failed check. No browser check is applicable to this backend-only task.

## Fix round 1 — test credential alignment

The review finding was reproduced by comparing the checked-in setup files: `.env.example` advertised `test_password`, while `compose.test.yaml` provisioned `count_timer_test`. This made the documented `TEST_DATABASE_URL` fail authentication.

### RED

I added `tests/unit/database-config.test.ts` before changing the configuration and ran:

```bash
npm run test:unit -- tests/unit/database-config.test.ts
```

It failed as expected:

```text
AssertionError: expected 'test_password' to be 'count_timer_test'
Tests  1 failed | 0 passed
```

### Fix and GREEN

The smallest fix was changing only `compose.test.yaml` to use the documented test-only placeholder password `test_password`. The focused regression test now verifies that the example URL matches Compose’s user, password, and database, and that the database name retains the `_test` suffix.

```text
Test Files  1 passed (1)
Tests  1 passed (1)
```

### Fix-round verification

With the refreshed PostgreSQL 16 container and corrected URL, these commands passed:

```bash
TEST_DATABASE_URL='postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test' \
  node scripts/migrate.mjs --test
TEST_DATABASE_URL='postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test' \
  npm run test:integration -- --reset tests/integration/identity.test.ts
TEST_DATABASE_URL='postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test' \
  node scripts/migrate.mjs --test
npm run test:unit
npm run lint
npm run typecheck
npm run build
```

The first migration applied `001_initial.sql`, the reset integration run passed 5/5 tests, and the second migration reported `Migration 001_initial.sql already applied; nothing to do.` The full unit suite passed 14/14, lint passed, typecheck passed, and the production build passed. The existing Vitest loader and Next experimental-setting warnings remain non-failing inherited warnings.
