import { NextResponse, type NextRequest } from 'next/server';

import { getOrCreateIdentity, InvalidIdentityError } from './identity';

export const IDENTITY_COOKIE_NAME = 'count_timer_token';
export const IDENTITY_COOKIE_MAX_AGE_SECONDS = 31_536_000;

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
  return jsonResponse({ error: 'service_unavailable' }, 503);
}
