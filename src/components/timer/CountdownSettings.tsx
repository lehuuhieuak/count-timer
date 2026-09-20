import type { ReactNode } from 'react';
import { useState } from 'react';

import { MAX_DURATION_MS, MIN_DURATION_MS } from '../../features/timer/engine';

type CountdownSettingsProps = {
  durationMs: number;
  disabled: boolean;
  onSetDuration: (durationMs: number) => Promise<void>;
  children?: ReactNode;
};

const presets = [
  { label: '5 phút', durationMs: 300_000 },
  { label: '15 phút', durationMs: 900_000 },
  { label: '25 phút', durationMs: 1_500_000 },
  { label: '50 phút', durationMs: 3_000_000 },
];

function durationParts(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1_000);
  return {
    hours: Math.floor(totalSeconds / 3_600),
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
  };
}

function CustomDurationForm({ durationMs, disabled, onSetDuration }: CountdownSettingsProps) {
  const parts = durationParts(durationMs);
  const [hours, setHours] = useState(String(parts.hours));
  const [minutes, setMinutes] = useState(String(parts.minutes));
  const [seconds, setSeconds] = useState(String(parts.seconds));
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedHours = Number(hours);
    const parsedMinutes = Number(minutes);
    const parsedSeconds = Number(seconds);
    const nextDurationMs = (parsedHours * 3_600 + parsedMinutes * 60 + parsedSeconds) * 1_000;
    if (
      !Number.isInteger(parsedHours) || !Number.isInteger(parsedMinutes) || !Number.isInteger(parsedSeconds)
      || parsedHours < 0 || parsedHours > 99 || parsedMinutes < 0 || parsedMinutes > 59
      || parsedSeconds < 0 || parsedSeconds > 59 || nextDurationMs < MIN_DURATION_MS || nextDurationMs > MAX_DURATION_MS
    ) {
      setError('Nhập thời lượng từ 1 giây đến 99:59:59.');
      return;
    }
    setError('');
    await onSetDuration(nextDurationMs);
  };

  return (
    <>
      <form className="custom" onSubmit={(event) => void submit(event)}>
        <span>Tùy chỉnh:</span>
        <div className="fields">
          <label><input aria-label="Giờ" name="hours" type="number" min="0" max="99" step="1" value={hours} disabled={disabled} onChange={(event) => setHours(event.target.value)} required />giờ</label>
          <label><input aria-label="Phút" name="minutes" type="number" min="0" max="59" step="1" value={minutes} disabled={disabled} onChange={(event) => setMinutes(event.target.value)} required />phút</label>
          <label><input aria-label="Giây" name="seconds" type="number" min="0" max="59" step="1" value={seconds} disabled={disabled} onChange={(event) => setSeconds(event.target.value)} required />giây</label>
        </div>
        <button type="submit" disabled={disabled}>Áp dụng</button>
      </form>
      <p className="error" role="alert" hidden={!error}>{error}</p>
    </>
  );
}

export function CountdownSettings({ durationMs, disabled, onSetDuration, children }: CountdownSettingsProps) {
  return (
    <>
      <div className="presets" aria-label="Thời lượng chọn nhanh">
        {presets.map((preset) => (
          <button
            key={preset.durationMs}
            type="button"
            disabled={disabled}
            aria-pressed={preset.durationMs === durationMs}
            onClick={() => void onSetDuration(preset.durationMs)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {children}
      <CustomDurationForm key={durationMs} durationMs={durationMs} disabled={disabled} onSetDuration={onSetDuration} />
    </>
  );
}
