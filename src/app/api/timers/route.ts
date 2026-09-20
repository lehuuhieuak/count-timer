import { type NextRequest } from 'next/server';

import { errorResponse, jsonResponse, requireIdentity } from '../../../lib/server/http';
import { readSnapshot } from '../../../lib/server/repository';

export async function GET(request: NextRequest) {
  try {
    const userId = await requireIdentity(request);
    return jsonResponse(await readSnapshot(userId, Date.now()));
  } catch (error) {
    return errorResponse(error);
  }
}
