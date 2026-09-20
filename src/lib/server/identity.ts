import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { createAnonymousUser, findUserIdByTokenHash } from './repository';

export class InvalidIdentityError extends Error {
  readonly statusCode = 401;

  constructor() {
    super('Invalid anonymous identity.');
    this.name = 'InvalidIdentityError';
  }
}

function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export async function getOrCreateIdentity(
  cookieToken?: string,
): Promise<{ userId: string; newToken?: string }> {
  if (cookieToken !== undefined) {
    const userId = await findUserIdByTokenHash(tokenHash(cookieToken));
    if (!userId) {
      throw new InvalidIdentityError();
    }
    return { userId };
  }

  const newToken = randomBytes(32).toString('base64url');
  const userId = randomUUID();
  await createAnonymousUser(userId, tokenHash(newToken));
  return { userId, newToken };
}
