import { describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/server/db', () => ({
  getPool: () => ({ query }),
}));

import { GET as getLive } from '../../src/app/api/health/live/route';
import { GET as getReady } from '../../src/app/api/health/ready/route';

describe('health routes', () => {
  it('reports liveness without consulting the database', async () => {
    const response = await getLive();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports readiness after a successful SELECT 1', async () => {
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const response = await getReady();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns a generic 503 when the database is unavailable', async () => {
    query.mockRejectedValueOnce(new Error('postgres://secret.example.internal/password'));

    const response = await getReady();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toBe(JSON.stringify({ status: 'not_ready' }));
    expect(body).not.toContain('secret.example.internal');
  });
});
