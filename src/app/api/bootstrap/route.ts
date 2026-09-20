import { type NextRequest } from 'next/server';

import { getOrCreateIdentity } from '../../../lib/server/identity';
import {
  errorResponse,
  IDENTITY_COOKIE_NAME,
  jsonResponse,
  readEmptyBody,
  requireSameOrigin,
} from '../../../lib/server/http';
import { readSnapshot } from '../../../lib/server/repository';

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    await readEmptyBody(request);
    const cookieToken = request.cookies.get(IDENTITY_COOKIE_NAME)?.value;
    const identity = await getOrCreateIdentity(cookieToken);
    const snapshot = await readSnapshot(identity.userId, Date.now());
    return jsonResponse(snapshot, 200, identity.newToken ?? cookieToken);
  } catch (error) {
    return errorResponse(error);
  }
}
