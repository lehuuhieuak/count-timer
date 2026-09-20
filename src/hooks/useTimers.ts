'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { interpolateTimer } from '../features/timer/client-time';
import type { Command, Snapshot } from '../features/timer/types';
import { playAlarm, unlockAudio } from './audio';
import { canAcceptSnapshot, isCommandApplied, shouldClaimExpiredCountdown } from './snapshot-guards';
import { createTabSync } from './tab-sync';

export type SyncState = 'loading' | 'synced' | 'saving' | 'unsynced';

export type UseTimersResult = {
  snapshot: Snapshot | null;
  displaySnapshot: Snapshot | null;
  connected: boolean;
  pending: boolean;
  syncState: SyncState;
  commandError: string | null;
  send: (command: Command) => Promise<boolean>;
  unlock: () => Promise<void>;
};

type SnapshotError = { snapshot?: Snapshot };
type SnapshotSource = 'bootstrap' | 'read' | 'command' | 'tab' | 'heartbeat';

function monotonicNow(): number {
  return typeof performance === 'undefined' ? 0 : performance.now();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

export function useTimers(): UseTimersResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const snapshotRef = useRef<Snapshot | null>(null);
  const commandPendingRef = useRef(false);
  const tabReadyRef = useRef(false);
  const [receivedAtMonotonicMs, setReceivedAtMonotonicMs] = useState(0);
  const tabSyncRef = useRef<ReturnType<typeof createTabSync> | null>(null);
  const previousDownRef = useRef<{ runId: string; valueMs: number; started: boolean } | null>(null);
  const claimedRunsRef = useRef(new Set<string>());
  const alarmInFlightRef = useRef(new Set<string>());
  const alarmRetryRef = useRef(new Set<string>());
  const alarmAttemptEpochRef = useRef(new Map<string, number>());
  const snapshotEpochRef = useRef(0);
  const onlineRef = useRef(true);
  const activeRef = useRef(true);

  const acceptSnapshot = useCallback((next: Snapshot, source: SnapshotSource): boolean => {
    if (!canAcceptSnapshot(snapshotRef.current, next, source === 'read' && commandPendingRef.current)) {
      return false;
    }
    snapshotRef.current = next;
    snapshotEpochRef.current += 1;
    setReceivedAtMonotonicMs(monotonicNow());
    setSnapshot(next);
    setConnected(tabReadyRef.current);
    return true;
  }, []);

  const readSnapshot = useCallback(async (): Promise<Snapshot | null> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      onlineRef.current = false;
      if (!commandPendingRef.current) {
        setConnected(false);
        setSyncState('unsynced');
      }
      return null;
    }

    try {
      const response = await fetch('/api/timers', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Snapshot read failed.');
      const next = await response.json() as Snapshot;
      if (!activeRef.current) return null;
      const accepted = acceptSnapshot(next, 'read');
      if (accepted) {
        if (!commandPendingRef.current) setSyncState('synced');
        onlineRef.current = true;
      }
      return accepted ? next : null;
    } catch {
      if (!commandPendingRef.current) {
        setConnected(false);
        setSyncState('unsynced');
      }
      return null;
    }
  }, [acceptSnapshot]);

  useEffect(() => {
    activeRef.current = true;
    const tabSync = createTabSync({
      onSnapshotNotice: () => { void readSnapshot(); },
      onReopen: (next) => {
        tabReadyRef.current = true;
        acceptSnapshot(next, 'tab');
        setConnected(true);
        setSyncState('synced');
      },
      onHeartbeatSnapshot: (next) => {
        tabReadyRef.current = true;
        if (acceptSnapshot(next, 'heartbeat') && !commandPendingRef.current) setSyncState('synced');
      },
      onLeaseClosed: () => {
        tabReadyRef.current = false;
        setConnected(false);
      },
      onError: () => {
        tabReadyRef.current = false;
        if (!commandPendingRef.current) {
          setConnected(false);
          setSyncState('unsynced');
        }
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
        if (!activeRef.current) return;
        tabReadyRef.current = false;
        acceptSnapshot(bootstrapped, 'bootstrap');
        const opened = await tabSync.open();
        if (!activeRef.current) return;
        tabReadyRef.current = true;
        acceptSnapshot(opened, 'tab');
        setConnected(true);
        setSyncState('synced');
        onlineRef.current = true;
      } catch {
        if (!activeRef.current || tabReadyRef.current) return;
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
      if (!commandPendingRef.current) {
        setConnected(false);
        setSyncState('unsynced');
      }
    };
    const onFocus = () => { void readSnapshot(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onFocus);
    void bootstrap();

    return () => {
      activeRef.current = false;
      tabReadyRef.current = false;
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
    const expiredNow = displaySnapshot.down.valueMs <= 0 && displaySnapshot.down.startedAtMs !== null;
    const completedRetry = displaySnapshot.completedRunId === displaySnapshot.downRunId
      && alarmRetryRef.current.has(displaySnapshot.downRunId)
      && alarmAttemptEpochRef.current.get(displaySnapshot.downRunId) !== snapshotEpochRef.current;
    if (!expiredNow && !completedRetry) {
      previousDownRef.current = {
        runId: displaySnapshot.downRunId,
        valueMs: displaySnapshot.down.valueMs,
        started: displaySnapshot.down.startedAtMs !== null,
      };
      return;
    }

    const shouldAttempt = completedRetry || shouldClaimExpiredCountdown(displaySnapshot, previous);
    previousDownRef.current = {
      runId: displaySnapshot.downRunId,
      valueMs: displaySnapshot.down.valueMs,
      started: displaySnapshot.down.startedAtMs !== null,
    };
    const runId = displaySnapshot.downRunId;
    if (!shouldAttempt || claimedRunsRef.current.has(runId) || alarmInFlightRef.current.has(runId)) return;
    alarmInFlightRef.current.add(runId);
    alarmAttemptEpochRef.current.set(runId, snapshotEpochRef.current);
    const soundEnabled = displaySnapshot.soundEnabled;

    const claimAndRefresh = async () => {
      try {
        const response = await fetch('/api/alarms', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
        });
        if (!response.ok) throw new Error('Alarm claim failed.');
        const result = await response.json() as { granted?: boolean };
        if (result.granted) {
          claimedRunsRef.current.add(runId);
          alarmRetryRef.current.delete(runId);
          if (soundEnabled) await playAlarm();
        } else {
          alarmRetryRef.current.delete(runId);
        }
      } catch {
        alarmRetryRef.current.add(runId);
      } finally {
        alarmInFlightRef.current.delete(runId);
        // The read that follows this claim is reconciliation, not a new retry opportunity.
        // A later focus, tab notice, or heartbeat advances the read epoch and may retry.
        alarmAttemptEpochRef.current.set(runId, snapshotEpochRef.current + 1);
        void readSnapshot();
      }
    };
    void claimAndRefresh();
  }, [displaySnapshot, readSnapshot]);

  const send = useCallback(async (command: Command): Promise<boolean> => {
    const current = snapshotRef.current;
    if (!current || commandPendingRef.current || !onlineRef.current) {
      setSyncState('unsynced');
      return false;
    }

    void unlockAudio();
    commandPendingRef.current = true;
    setPending(true);
    setCommandError(null);
    setSyncState('saving');
    const failureMessage = command.type === 'reset'
      ? 'Không thể đồng bộ thao tác đặt lại.'
      : 'Không thể đồng bộ thao tác.';
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
        acceptSnapshot(body.snapshot, 'command');
        tabSyncRef.current?.announce();
        setSyncState('synced');
        return false;
      }
      if (!response.ok) throw new Error('Timer command failed.');
      acceptSnapshot(body, 'command');
      tabSyncRef.current?.announce();
      setSyncState('synced');
      onlineRef.current = true;
      return true;
    } catch (error) {
      if (isAbortError(error)) {
        commandPendingRef.current = false;
        const readBack = await readSnapshot();
        if (readBack) {
          const applied = isCommandApplied(readBack, command, current.revision);
          setCommandError(applied ? null : failureMessage);
          setSyncState(applied ? 'synced' : 'unsynced');
          setConnected(tabReadyRef.current);
          return applied;
        }
      }
      setConnected(false);
      setCommandError(failureMessage);
      setSyncState('unsynced');
      return false;
    } finally {
      commandPendingRef.current = false;
      setPending(false);
    }
  }, [acceptSnapshot, readSnapshot]);

  return { snapshot, displaySnapshot, connected, pending, syncState, commandError, send, unlock: unlockAudio };
}
