import type { TimerKind } from '../../features/timer/types';

type TimerControlsProps = {
  kind: TimerKind;
  label: string;
  disabled: boolean;
  onToggle: () => void;
  onReset: () => void;
  onSound?: () => void;
  soundEnabled?: boolean;
};

export function TimerControls({ kind, label, disabled, onToggle, onReset, onSound, soundEnabled }: TimerControlsProps) {
  return (
    <div className="actions">
      <button type="button" className="primary" disabled={disabled} onClick={onToggle}>{label}</button>
      <button type="button" className="secondary" disabled={disabled} onClick={onReset}>↺ Đặt lại</button>
      {kind === 'down' && onSound && (
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          aria-pressed={soundEnabled}
          onClick={onSound}
        >
          Âm thanh: {soundEnabled ? 'Bật' : 'Tắt'}
        </button>
      )}
    </div>
  );
}
