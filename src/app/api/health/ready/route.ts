import { jsonResponse } from '../../../../lib/server/http';
import { getPool } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await getPool().query('SELECT 1');
    return jsonResponse({ status: 'ok' });
  } catch {
    return jsonResponse({ status: 'not_ready' }, 503);
  }
}
