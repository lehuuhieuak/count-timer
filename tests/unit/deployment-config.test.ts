import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

const dockerfile = readFileSync(`${process.cwd()}/Dockerfile`, 'utf8');
const dockerignore = readFileSync(`${process.cwd()}/.dockerignore`, 'utf8');
const compose = readFileSync(`${process.cwd()}/compose.yaml`, 'utf8');
const envExample = readFileSync(`${process.cwd()}/.env.example`, 'utf8');
const gitignore = readFileSync(`${process.cwd()}/.gitignore`, 'utf8');
const readme = readFileSync(`${process.cwd()}/README.md`, 'utf8');

describe('production deployment contract', () => {
  it('uses Next standalone output', () => {
    expect(nextConfig.output).toBe('standalone');
  });

  it('builds a pinned non-root runtime with migration assets', () => {
    expect(dockerfile).toContain('FROM node:24.20.0-alpine AS base');
    expect(dockerfile).toContain('FROM deps AS builder');
    expect(dockerfile).toContain('FROM base AS runner');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/public ./public');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations');
    expect(dockerfile).toContain('USER nextjs');
    expect(dockerfile).not.toMatch(/COPY .*\b(?:tests|docs|\.env)\b/);
  });

  it('keeps production Compose app-only and private by default', () => {
    expect(compose.match(/^\u0020{2}[a-z][\w-]*:\s*$/gm)).toEqual(['  app:']);
    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toContain('127.0.0.1:3000:3000');
    expect(compose).toContain('/api/health/ready');
    expect(compose).toContain('DATABASE_URL: ${DATABASE_URL:?');
    expect(compose).toContain('APP_ORIGIN: ${APP_ORIGIN:?');
  });

  it('excludes development and secret files from the image context', () => {
    expect(dockerignore).toMatch(/^tests$/m);
    expect(dockerignore).toMatch(/^docs$/m);
    expect(dockerignore).toMatch(/^\.env\*$/m);
    expect(dockerignore).toMatch(/^\.superpowers$/m);
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });

  it('documents safe database connectivity and explicit release operations', () => {
    const databaseUrl = envExample.match(/^DATABASE_URL=(.+)$/m)?.[1];
    expect(databaseUrl).toBeTruthy();
    expect(new URL(databaseUrl!).hostname).not.toBe('localhost');
    expect(envExample).toContain('APP_ORIGIN=https://timer.example.com');
    expect(envExample).toContain('BACKUP_DATABASE_URL=');
    expect(readme).toContain('pg_dump');
    expect(readme).toContain('docker compose run --rm --no-deps app node scripts/migrate.mjs');
    expect(readme).toContain('host.docker.internal');
    expect(readme).toContain('docker network create web-proxy');
    expect(readme).toContain('APP_IMAGE=count-timer:<previous-release>');
    expect(readme).toContain('ports: !reset []');
    expect(readme).toContain('BACKUP_DATABASE_URL');
  });
});
