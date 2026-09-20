import { type NextRequest } from 'next/server';

import {
  BadRequestError,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireIdentity,
  requireSameOrigin,
} from '../../../lib/server/http';
import { claimAlarm } from '../../../lib/server/repository';

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(value: unknown): { runId: string } {
  if (!isRecord(value) || typeof value.runId !== 'string' || !RUN_ID_PATTERN.test(value.runId)) {
    throw new BadRequestError('Run ID is invalid.');
  }
  return { runId: value.runId };
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const userId = await requireIdentity(request);
    const { runId } = parseBody(await readJsonBody(request));
    return jsonResponse({ granted: await claimAlarm(userId, runId) });
  } catch (error) {
    return errorResponse(error);
  }
}
