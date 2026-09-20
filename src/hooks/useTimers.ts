'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { interpolateTimer } from '../features/timer/client-time';
import type { Command, Snapshot } from '../features/timer/types';
import { playAlarm, unlockAudio } from './audio';
import { createTabSync } from './tab-sync';

export type SyncState = 'loading' | 'synced' | 'saving' | 'unsynced';

export type UseTimersResult = {
  snapshot: Snapshot | null;
  displaySnapshot: Snapshot | null;
  connected: boolean;
  pending: boolean;
  syncState: SyncState;
  send: (command: Command) => Promise<void>;
  unlock: () => Promise<void>;
};

type SnapshotError = { snapshot?: Snapshot };

function monotonicNow(): number {
  return typeof performance === 'undefined' ? 0 : performance.now();
}

export function useTimers(): UseTimersResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [, setTick] = useState(0);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [receivedAtMonotonicMs, setReceivedAtMonotonicMs] = useState(0);
  const tabSyncRef = useRef<ReturnType<typeof createTabSync> | null>(null);
  const previousDownRef = useRef<{ runId: string; valueMs: number; started: boolean } | null>(null);
  const claimedRunsRef = useRef(new Set<string>());
  const onlineRef = useRef(true);

  const acceptSnapshot = useCallback((next: Snapshot) => {
    snapshotRef.current = next;
    setReceivedAtMonotonicMs(monotonicNow());
    setSnapshot(next);
    setConnected(true);
  }, []);

  const readSnapshot = useCallback(async (): Promise<Snapshot | null> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      onlineRef.current = false;
      setConnected(false);
      setSyncState('unsynced');
      return null;
    }

    try {
      const response = await fetch('/api/timers', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Snapshot read failed.');
      const next = await response.json() as Snapshot;
      acceptSnapshot(next);
      setSyncState('synced');
      onlineRef.current = true;
      return next;
    } catch {
      setConnected(false);
      setSyncState('unsynced');
      return null;
    }
  }, [acceptSnapshot]);

  useEffect(() => {
    let active = true;
    const tabSync = createTabSync({
      onSnapshotNotice: () => { void readSnapshot(); },
      onReopen: () => { void readSnapshot(); },
      onError: () => {
        setConnected(false);
        setSyncState('unsynced');
      },
    });
    tabSyncRef.current = tabSync;

    const bootstrap = async () => {
      try {
        const response = await fetch('/api/bootstrap', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Bootstrap failed.');
        const bootstrapped = await response.json() as Snapshot;
        if (!active) return;
        acceptSnapshot(bootstrapped);
        const opened = await tabSync.open();
        if (!active) return;
        acceptSnapshot(opened);
        setSyncState('synced');
        onlineRef.current = true;
      } catch {
        if (!active) return;
        setConnected(false);
        setSyncState('unsynced');
      }
    };

    const onOnline = () => {
      onlineRef.current = true;
      void readSnapshot();
    };
    const onOffline = () => {
      onlineRef.current = false;
      setConnected(false);
      setSyncState('unsynced');
    };
    const onFocus = () => { void readSnapshot(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onFocus);
    void bootstrap();

    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onFocus);
      tabSync.destroy();
      tabSyncRef.current = null;
    };
  }, [acceptSnapshot, readSnapshot]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setTick((value) => value + 1), 100);
    return () => window.clearInterval(intervalId);
  }, []);

  const displaySnapshot = snapshot
    ? (() => {
        const now = monotonicNow();
        const serverNow = snapshot.serverNowMs + Math.max(0, now - receivedAtMonotonicMs);
        return {
          ...snapshot,
          serverNowMs: serverNow,
          up: { ...snapshot.up, valueMs: interpolateTimer(snapshot.up, 'up', snapshot.serverNowMs, receivedAtMonotonicMs, now) },
          down: { ...snapshot.down, valueMs: interpolateTimer(snapshot.down, 'down', snapshot.serverNowMs, receivedAtMonotonicMs, now) },
        };
      })()
    : null;

  useEffect(() => {
    if (!displaySnapshot) return;
    const previous = previousDownRef.current;
    if (displaySnapshot.down.startedAtMs === null || displaySnapshot.down.valueMs > 0) {
      previousDownRef.current = {
        runId: displaySnapshot.downRunId,
        valueMs: displaySnapshot.down.valueMs,
        started: displaySnapshot.down.startedAtMs !== null,
      };
      return;
    }

    const crossedZero = previous?.runId === displaySnapshot.downRunId && previous.started && previous.valueMs > 0;
    previousDownRef.current = {
      runId: displaySnapshot.downRunId,
      valueMs: displaySnapshot.down.valueMs,
      started: true,
    };
    if (!crossedZero || claimedRunsRef.current.has(displaySnapshot.downRunId)) return;
    claimedRunsRef.current.add(displaySnapshot.downRunId);

    const runId = displaySnapshot.downRunId;
    const soundEnabled = displaySnapshot.soundEnabled;
    const claimAndRefresh = async () => {
      try {
        const response = await fetch('/api/alarms', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
        });
        const result = await response.json() as { granted?: boolean };
        if (soundEnabled && response.ok && result.granted) await playAlarm();
      } catch {
        // Hết giờ remains visible even when the alarm claim or audio fails.
      } finally {
        void readSnapshot();
      }
    };
    void claimAndRefresh();
  }, [displaySnapshot, readSnapshot]);

  const send = useCallback(async (command: Command) => {
    const current = snapshotRef.current;
    if (!current || pending || !onlineRef.current) {
      setSyncState('unsynced');
      return;
    }

    void unlockAudio();
    setPending(true);
    setSyncState('saving');
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 8_000);
      let response: Response;
      try {
        response = await fetch('/api/timers', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: current.revision, command }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const body = await response.json() as Snapshot & SnapshotError;
      if (response.status === 409 && body.snapshot) {
        acceptSnapshot(body.snapshot);
        tabSyncRef.current?.announce();
        setSyncState('synced');
        return;
      }
      if (!response.ok) throw new Error('Timer command failed.');
      acceptSnapshot(body);
      tabSyncRef.current?.announce();
      setSyncState('synced');
      onlineRef.current = true;
    } catch {
      setConnected(false);
      setSyncState('unsynced');
    } finally {
      setPending(false);
    }
  }, [acceptSnapshot, pending]);

  return { snapshot, displaySnapshot, connected, pending, syncState, send, unlock: unlockAudio };
}
