'use client';

import { useCallback, useMemo, useState } from 'react';

import { formatDisplayDuration } from '../../features/timer/client-time';
import type { TimerKind } from '../../features/timer/types';
import { useHotkeys } from '../../hooks/hotkeys';
import { useTimers } from '../../hooks/useTimers';
import { CountdownSettings } from './CountdownSettings';
import { ResetDialog } from './ResetDialog';
import { SyncStatus } from './SyncStatus';
import { TimerControls } from './TimerControls';
import { TimerDisplay } from './TimerDisplay';
import { TimerTabs } from './TimerTabs';

export function TimerPage() {
  const [selected, setSelected] = useState<TimerKind>('up');
  const [resetOpen, setResetOpen] = useState(false);
  const timers = useTimers();
  const snapshot = timers.snapshot;
  const display = timers.displaySnapshot;
  const ready = snapshot !== null;
  const disabled = !ready || timers.pending || timers.syncState === 'unsynced' || !timers.connected;

  const running = {
    up: Boolean(display?.up.startedAtMs !== null && (display?.up.valueMs ?? 0) > 0),
    down: Boolean(display?.down.startedAtMs !== null && (display?.down.valueMs ?? 0) > 0),
  };

  const toggle = useCallback((kind: TimerKind) => {
    if (!snapshot || !display) return;
    const ended = kind === 'down' && display.down.valueMs <= 0;
    void timers.send({ type: ended || snapshot[kind].startedAtMs === null ? 'start' : 'pause', timer: kind });
  }, [display, snapshot, timers]);

  useHotkeys(() => toggle(selected));

  const toggleLabel = useMemo(() => {
    if (!snapshot || !display) return 'Bắt đầu';
    if (selected === 'down' && display.down.valueMs <= 0) return 'Bắt đầu lại';
    if (snapshot[selected].startedAtMs !== null) return 'Tạm dừng';
    return (selected === 'up' ? display.up.valueMs > 0 : display.down.valueMs < snapshot.durationMs)
      ? 'Tiếp tục'
      : 'Bắt đầu';
  }, [display, selected, snapshot]);

  const reset = () => {
    if (!snapshot) return;
    if (selected === 'up') setResetOpen(true);
    else void timers.send({ type: 'reset', timer: 'down' });
  };

  const selectedDisplayMs = display?.[selected].valueMs ?? 0;
  const selectedValue = formatDisplayDuration(selectedDisplayMs, selected);

  return (
    <div className="app-shell">
      <header>
        <div className="brand">Count Timer</div>
        <TimerTabs selected={selected} onChange={setSelected} running={running} />
        <SyncStatus state={timers.syncState} />
      </header>
      <main>
        <section className="panel" id="panel-up" role="tabpanel" aria-labelledby="tab-up" hidden={selected !== 'up'}>
          {ready ? <TimerDisplay kind="up" valueMs={display?.up.valueMs ?? snapshot.up.valueMs} durationMs={snapshot.durationMs} running={running.up} /> : <div className="status">Đang tải</div>}
          <div className="digits" hidden={ready}>--:--:--</div>
          <TimerControls kind="up" label={toggleLabel} disabled={disabled} onToggle={() => toggle('up')} onReset={reset} />
          <p className="hint">Nhấn <kbd>Space</kbd> để bắt đầu / tạm dừng / tiếp tục</p>
        </section>
        <section className="panel" id="panel-down" role="tabpanel" aria-labelledby="tab-down" hidden={selected !== 'down'}>
          {ready ? (
            <>
              <CountdownSettings
                durationMs={snapshot.durationMs}
                disabled={disabled || snapshot.down.startedAtMs !== null}
                onSetDuration={(durationMs) => timers.send({ type: 'set-duration', durationMs })}
              >
                <TimerDisplay
                  kind="down"
                  valueMs={display?.down.valueMs ?? snapshot.down.valueMs}
                  durationMs={snapshot.durationMs}
                  running={running.down}
                  ended={(display?.down.valueMs ?? snapshot.down.valueMs) <= 0}
                />
              </CountdownSettings>
              <TimerControls
                kind="down"
                label={toggleLabel}
                disabled={disabled}
                onToggle={() => toggle('down')}
                onReset={reset}
                soundEnabled={snapshot.soundEnabled}
                onSound={() => void timers.send({ type: 'set-sound', enabled: !snapshot.soundEnabled })}
              />
              <p className="hint">Nhấn <kbd>Space</kbd> để bắt đầu / tạm dừng / tiếp tục</p>
            </>
          ) : (
            <div className="status">Đang tải</div>
          )}
        </section>
      </main>
      <footer>Ứng dụng dùng danh tính ẩn danh trong cookie của trình duyệt này.</footer>
      <ResetDialog
        open={resetOpen}
        formattedValue={selectedValue}
        confirmDisabled={disabled}
        error={timers.commandError}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          void timers.send({ type: 'reset', timer: 'up' }).then((succeeded) => {
            if (succeeded) setResetOpen(false);
          });
        }}
      />
    </div>
  );
}
