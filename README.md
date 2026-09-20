# Count Timer

Count Timer is a Next.js application backed by PostgreSQL. The production image listens on port `3000`; an existing reverse proxy terminates TLS and forwards requests to the app.

## Environment

Copy the example file and set the values for the deployment:

```bash
cp .env.example .env
```

The Compose file requires these variables and passes them to the app without storing them in the image:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by the app and the explicit migration runner. |
| `APP_ORIGIN` | The exact public origin, including scheme and port when applicable; mutation requests must match it. |
| `APP_IMAGE` | Optional image tag for rollback or a separately built release; defaults to `count-timer:local`. |
| `BACKUP_DATABASE_URL` | Host-reachable database URL used by `pg_dump`; set separately when `DATABASE_URL` uses a container-only hostname. |

The values in `.env.example` are placeholders. A container's `localhost` is the container itself, so it cannot reach PostgreSQL on the Docker host through `127.0.0.1`. For a database on the host, use `host.docker.internal` (the Compose file supplies the Linux `host-gateway` mapping), and configure PostgreSQL to listen on the required interface and permit the app role. For a database in another container, attach the app and database to a shared Docker network and use the database service name as the hostname. For a remote database, use its DNS name and firewall-approved port.

## Build and run locally

The production Compose file intentionally contains only the app service. It does not create PostgreSQL, run migrations on startup, or install a reverse proxy.

```bash
docker compose config --quiet
docker compose build
```

Back up the database before applying a migration. Run `pg_dump` from a machine that can reach the database, for example:

```bash
set -a
. ./.env
set +a
pg_dump --format=custom --file="count-timer-$(date +%Y%m%d-%H%M%S).dump" "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL to a host-reachable database URL}"
```

Apply schema changes as an explicit operation. This command runs the existing PostgreSQL migration runner inside the image and is deliberately separate from application startup:

```bash
docker compose run --rm --no-deps app node scripts/migrate.mjs
docker compose up -d
```

`docker compose up -d` never runs migrations. Repeat the backup and explicit migration command for each release that changes `db/migrations`.

Check the process and database health, then inspect the container state and logs when needed:

```bash
curl --fail http://127.0.0.1:3000/api/health/live
curl --fail http://127.0.0.1:3000/api/health/ready
docker compose ps
docker compose logs --tail=100 app
```

The liveness endpoint returns 200 while the process is running. Readiness executes `SELECT 1`, returns 200 only when PostgreSQL responds, and returns a generic 503 without connection details when it cannot connect. The same readiness URL is used by the Compose healthcheck.

## Reverse proxy and DNS/TLS

The default Compose binding is `127.0.0.1:3000:3000`. This is the host-proxy arrangement: an existing reverse proxy on the host should forward the application origin to `http://127.0.0.1:3000`, while keeping port 3000 off the public interface. Configure the proxy to pass the original `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers.

Point the public DNS A/AAAA record for the chosen hostname at the reverse proxy host. Configure the proxy's certificate issuer (for example, its existing ACME integration) for that hostname, redirect HTTP to HTTPS, and set `APP_ORIGIN` to the final HTTPS URL. Verify that the proxy can reach the loopback upstream and that the certificate covers the exact hostname before opening the site.

If the reverse proxy runs in Docker, use a shared external network instead of exposing the app through a host port. Create the network once, add both services to it, remove the `ports` mapping from the app service, and keep `expose: ["3000"]`:

```bash
docker network create web-proxy
```

The proxy then uses `http://app:3000` (the Compose service name) as its upstream. Its Compose project must join the same external network:

```yaml
services:
  app:
    networks: [web-proxy]
    ports: !reset []

networks:
  web-proxy:
    external: true
    name: web-proxy
```

Save that as `compose.proxy.yaml` and use `docker compose -f compose.yaml -f compose.proxy.yaml config --quiet` before starting the stack. The `!reset []` Compose tag removes the host binding inherited from `compose.yaml`; an empty list alone does not.

Choose one proxy arrangement for a deployment. Do not bind the app to `0.0.0.0` merely to make a host proxy work, and do not use a container's `localhost` as the hostname for a database or proxy in another container.

## Releases, migrations, backup, and rollback

Build and retain an immutable image tag for each release, preferably the source commit:

```bash
docker build --tag count-timer:$(git rev-parse --short HEAD) .
```

After the backup, point `APP_IMAGE` at the release and run the explicit migration before replacing the app:

```bash
APP_IMAGE=count-timer:<release> docker compose run --rm --no-deps app node scripts/migrate.mjs
APP_IMAGE=count-timer:<release> docker compose up -d --no-build
```

To roll back application code, select the previously retained image and recreate the app:

```bash
APP_IMAGE=count-timer:<previous-release> docker compose up -d --no-build
```

A previous image does not automatically undo a database migration. If the release changed the schema incompatibly, stop and restore the verified database backup according to the database operator's procedure before starting the old image. Keep the backup and old image until the new release has passed both health checks and a smoke check through the reverse proxy.

## Development checks

Install dependencies with the locked versions and use the existing scripts:

```bash
npm ci
npm run test:unit
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

Integration tests use the separate `TEST_DATABASE_URL` from `.env.example` and `compose.test.yaml`; it must end in `_test`. Never point test migration or integration commands at the production `DATABASE_URL`.
