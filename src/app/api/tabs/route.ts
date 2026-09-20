import { type NextRequest } from 'next/server';

import {
  BadRequestError,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireIdentity,
  requireSameOrigin,
} from '../../../lib/server/http';
import { touchTab, type TabAction } from '../../../lib/server/leases';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(value: unknown): { tabId: string; action: TabAction } {
  if (!isRecord(value) || typeof value.tabId !== 'string' || value.tabId.length === 0 || value.tabId.length > 256) {
    throw new BadRequestError('Tab ID is invalid.');
  }
  if (value.action !== 'open' && value.action !== 'heartbeat' && value.action !== 'close') {
    throw new BadRequestError('Tab action is invalid.');
  }
  return { tabId: value.tabId, action: value.action };
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const userId = await requireIdentity(request);
    const { tabId, action } = parseBody(await readJsonBody(request));
    return jsonResponse(await touchTab(userId, tabId, action, Date.now()));
  } catch (error) {
    return errorResponse(error);
  }
}
