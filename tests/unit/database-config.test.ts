import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const envExample = readFileSync(`${process.cwd()}/.env.example`, 'utf8');
const composeTest = readFileSync(`${process.cwd()}/compose.test.yaml`, 'utf8');

function composeValue(name: string): string {
  const match = composeTest.match(new RegExp(`^\\s+${name}:\\s+([^\\s]+)$`, 'm'));
  if (!match) {
    throw new Error(`${name} is missing from compose.test.yaml`);
  }
  return match[1];
}

describe('PostgreSQL integration setup', () => {
  it('keeps the documented test URL aligned with the Compose credentials', () => {
    const urlMatch = envExample.match(/^TEST_DATABASE_URL=(.+)$/m);
    expect(urlMatch).toBeTruthy();

    const testUrl = new URL(urlMatch![1]);
    expect(testUrl.username).toBe(composeValue('POSTGRES_USER'));
    expect(testUrl.password).toBe(composeValue('POSTGRES_PASSWORD'));
    expect(testUrl.pathname.slice(1)).toBe(composeValue('POSTGRES_DB'));
    expect(testUrl.pathname.slice(1)).toMatch(/_test$/);
  });
});
