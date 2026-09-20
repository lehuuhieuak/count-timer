import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import {
  BadRequestError,
  MAX_REQUEST_BODY_BYTES,
  readJsonBody,
} from '../../src/lib/server/http';

describe('readJsonBody', () => {
  it('rejects an oversized stream after bounded reads without Content-Length', async () => {
    const chunkSize = 1_024;
    const totalChunks = Math.ceil(MAX_REQUEST_BODY_BYTES / chunkSize) + 32;
    const boundedReadLimit = Math.ceil(MAX_REQUEST_BODY_BYTES / chunkSize) + 2;
    let reads = 0;
    let cancelled = false;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(chunkSize).fill(0x61));
        if (reads === totalChunks) {
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new NextRequest('https://timer.example.test/api/timers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    });

    expect(request.headers.get('content-length')).toBeNull();
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(BadRequestError);
    expect(reads).toBeLessThanOrEqual(boundedReadLimit);
    expect(reads).toBeLessThan(totalChunks);
    expect(cancelled).toBe(true);
  });

  it('parses valid UTF-8 JSON when a character spans chunks', async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({ message: 'Đếm ngược' }));
    const split = encoded.findIndex((byte, index) => index > 0 && byte >= 0x80);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, split + 1));
        controller.enqueue(encoded.slice(split + 1));
        controller.close();
      },
    });
    const request = new NextRequest('https://timer.example.test/api/timers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    });

    await expect(readJsonBody(request)).resolves.toEqual({ message: 'Đếm ngược' });
  });
});
