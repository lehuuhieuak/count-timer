import { NextResponse, type NextRequest } from 'next/server';

import { InvalidCommandError, RevisionConflictError } from './repository';
import { getOrCreateIdentity, InvalidIdentityError } from './identity';

export const IDENTITY_COOKIE_NAME = 'count_timer_token';
export const IDENTITY_COOKIE_MAX_AGE_SECONDS = 31_536_000;
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

export class BadRequestError extends Error {
  readonly statusCode = 400;

  constructor(message = 'Invalid request.') {
    super(message);
    this.name = 'BadRequestError';
  }
}

function secureCookie(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) {
    return false;
  }
  try {
    return new URL(appOrigin).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function requireIdentity(request: NextRequest): Promise<string> {
  const cookieToken = request.cookies.get(IDENTITY_COOKIE_NAME)?.value;
  if (!cookieToken) {
    throw new InvalidIdentityError();
  }
  return (await getOrCreateIdentity(cookieToken)).userId;
}

export function requireSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin');
  if (!process.env.APP_ORIGIN || origin !== process.env.APP_ORIGIN) {
    throw new BadRequestError('Origin is not allowed.');
  }
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_REQUEST_BODY_BYTES) {
      throw new BadRequestError('Request body is too large.');
    }
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BODY_BYTES) {
    throw new BadRequestError('Request body is too large.');
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new BadRequestError('Request body must be valid JSON.');
  }
}

export function jsonResponse<T>(body: T, status = 200, newToken?: string): NextResponse<T> {
  const response = NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
  if (newToken) {
    response.cookies.set({
      name: IDENTITY_COOKIE_NAME,
      value: newToken,
      httpOnly: true,
      secure: secureCookie(),
      sameSite: 'lax',
      path: '/',
      maxAge: IDENTITY_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export function errorResponse(error: unknown): NextResponse<{ error: string }> {
  if (error instanceof InvalidIdentityError) {
    return jsonResponse({ error: 'unauthorized' }, error.statusCode);
  }
  if (error instanceof RevisionConflictError) {
    return jsonResponse({ error: 'conflict', snapshot: error.snapshot }, error.statusCode);
  }
  if (error instanceof BadRequestError || error instanceof InvalidCommandError) {
    return jsonResponse({ error: 'bad_request' }, 400);
  }
  return jsonResponse({ error: 'service_unavailable' }, 503);
}
