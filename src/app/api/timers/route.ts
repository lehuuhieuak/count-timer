import { type NextRequest } from 'next/server';

import type { Command } from '../../../features/timer/types';
import { MAX_DURATION_MS, MIN_DURATION_MS } from '../../../features/timer/engine';
import {
  BadRequestError,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireIdentity,
  requireSameOrigin,
} from '../../../lib/server/http';
import { executeCommand, readSnapshot } from '../../../lib/server/repository';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCommand(value: unknown): Command {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new BadRequestError('Command is invalid.');
  }

  if (value.type === 'start' || value.type === 'pause' || value.type === 'reset') {
    if (value.timer !== 'up' && value.timer !== 'down') {
      throw new BadRequestError('Timer is invalid.');
    }
    return { type: value.type, timer: value.timer };
  }

  if (value.type === 'set-duration') {
    if (
      typeof value.durationMs !== 'number' ||
      !Number.isSafeInteger(value.durationMs) ||
      value.durationMs < MIN_DURATION_MS ||
      value.durationMs > MAX_DURATION_MS
    ) {
      throw new BadRequestError('Duration is invalid.');
    }
    return { type: value.type, durationMs: value.durationMs };
  }

  if (value.type === 'set-sound') {
    if (typeof value.enabled !== 'boolean') {
      throw new BadRequestError('Sound setting is invalid.');
    }
    return { type: value.type, enabled: value.enabled };
  }

  throw new BadRequestError('Command type is invalid.');
}

function parseCommandBody(value: unknown): { expectedRevision: number; command: Command } {
  if (!isRecord(value)) {
    throw new BadRequestError('Request body is invalid.');
  }
  const expectedRevision = value.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new BadRequestError('Revision is invalid.');
  }
  return {
    expectedRevision,
    command: parseCommand(value.command),
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireIdentity(request);
    return jsonResponse(await readSnapshot(userId, Date.now()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const userId = await requireIdentity(request);
    const { expectedRevision, command } = parseCommandBody(await readJsonBody(request));
    return jsonResponse(await executeCommand(userId, expectedRevision, command, Date.now()));
  } catch (error) {
    return errorResponse(error);
  }
}
