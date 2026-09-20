'use client';

import type { Snapshot } from '../features/timer/types';

type TabSyncOptions = {
  onSnapshotNotice: () => void;
  onReopen: () => void;
  onError: () => void;
};

const HEARTBEAT_MS = 15_000;

function makeTabId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
}

async function postTabAction(tabId: string, action: 'open' | 'heartbeat' | 'close'): Promise<Snapshot> {
  const response = await fetch('/api/tabs', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId, action }),
    keepalive: action === 'close',
  });
  if (!response.ok) throw new Error(`Tab ${action} failed.`);
  return response.json() as Promise<Snapshot>;
}

export function createTabSync(options: TabSyncOptions) {
  const tabId = makeTabId();
  let destroyed = false;
  let opened = false;
  let heartbeatId: number | null = null;
  let channel: BroadcastChannel | null = null;

  const sendHeartbeat = () => {
    if (destroyed || !opened || !navigator.onLine) return;
    void postTabAction(tabId, 'heartbeat').catch(options.onError);
  };

  const open = async (): Promise<Snapshot> => {
    if (destroyed) throw new Error('Tab sync has been destroyed.');
    const snapshot = await postTabAction(tabId, 'open');
    opened = true;
    if (heartbeatId === null) heartbeatId = window.setInterval(sendHeartbeat, HEARTBEAT_MS);
    return snapshot;
  };

  const announce = () => {
    channel?.postMessage({ type: 'snapshot-changed', tabId });
  };

  const onPageHide = () => {
    if (destroyed || !opened) return;
    const body = JSON.stringify({ tabId, action: 'close' });
    const blob = new Blob([body], { type: 'application/json' });
    if (!navigator.sendBeacon('/api/tabs', blob)) {
      void fetch('/api/tabs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
    opened = false;
  };

  const onPageShow = () => {
    if (destroyed) return;
    options.onReopen();
  };

  const onChannelMessage = (event: MessageEvent<{ type?: string; tabId?: string }>) => {
    if (event.data?.type === 'snapshot-changed' && event.data.tabId !== tabId) options.onSnapshotNotice();
  };

  if ('BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel('count-timer-v1');
      channel.addEventListener('message', onChannelMessage);
    } catch {
      channel = null;
    }
  }
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  return {
    open,
    announce,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      channel?.removeEventListener('message', onChannelMessage);
      channel?.close();
      channel = null;
    },
  };
}
