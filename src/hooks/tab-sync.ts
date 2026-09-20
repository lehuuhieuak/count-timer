'use client';

import type { Snapshot } from '../features/timer/types';

type TabSyncOptions = {
  onSnapshotNotice: () => void;
  onReopen: (snapshot: Snapshot) => void;
  onHeartbeatSnapshot: (snapshot: Snapshot) => void;
  onLeaseClosed: () => void;
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
  let tabId = makeTabId();
  let destroyed = false;
  let opened = false;
  let heartbeatId: number | null = null;
  let channel: BroadcastChannel | null = null;
  let openPromise: Promise<Snapshot> | null = null;
  let openGeneration = 0;

  const stopHeartbeat = () => {
    if (heartbeatId !== null) window.clearInterval(heartbeatId);
    heartbeatId = null;
  };

  const startHeartbeat = () => {
    if (heartbeatId === null) heartbeatId = window.setInterval(sendHeartbeat, HEARTBEAT_MS);
  };

  const sendHeartbeat = () => {
    if (destroyed || !opened || !navigator.onLine) return;
    void postTabAction(tabId, 'heartbeat')
      .then((snapshot) => {
        if (!destroyed && opened) options.onHeartbeatSnapshot(snapshot);
      })
      .catch(() => {
        if (!destroyed && opened) options.onError();
      });
  };

  const open = async (): Promise<Snapshot> => {
    if (destroyed) throw new Error('Tab sync has been destroyed.');
    if (openPromise) return openPromise;
    const requestedTabId = tabId;
    const requestedGeneration = openGeneration;
    const pendingOpen = postTabAction(requestedTabId, 'open')
      .then((snapshot) => {
        if (destroyed || requestedGeneration !== openGeneration || requestedTabId !== tabId) {
          void postTabAction(requestedTabId, 'close').catch(() => undefined);
          throw new Error('Tab open was superseded.');
        }
        opened = true;
        startHeartbeat();
        return snapshot;
      })
      .finally(() => {
        if (openPromise === pendingOpen) openPromise = null;
      });
    openPromise = pendingOpen;
    return pendingOpen;
  };

  const announce = () => {
    channel?.postMessage({ type: 'snapshot-changed', tabId });
  };

  const onPageHide = () => {
    if (destroyed) return;
    const closingTabId = tabId;
    const wasOpened = opened;
    openGeneration += 1;
    opened = false;
    openPromise = null;
    stopHeartbeat();
    options.onLeaseClosed();
    if (!wasOpened) return;

    const body = JSON.stringify({ tabId: closingTabId, action: 'close' });
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
  };

  const onPageShow = () => {
    if (destroyed) return;
    if (opened) return;
    tabId = makeTabId();
    void open().then(options.onReopen).catch(() => options.onError());
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
      stopHeartbeat();
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      channel?.removeEventListener('message', onChannelMessage);
      channel?.close();
      channel = null;
    },
  };
}
