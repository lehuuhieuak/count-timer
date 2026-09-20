import { formatDisplayDuration } from '../../features/timer/client-time';
import type { TimerKind } from '../../features/timer/types';

type TimerDisplayProps = {
  kind: TimerKind;
  valueMs: number;
  durationMs: number;
  running: boolean;
  ended?: boolean;
};

export function TimerDisplay({ kind, valueMs, durationMs, running, ended = false }: TimerDisplayProps) {
  const formatted = formatDisplayDuration(valueMs, kind);
  if (kind === 'up') {
    return (
      <>
        <div className="status" role="status">
          {running ? 'Đang đếm thời gian' : valueMs > 0 ? 'Đã tạm dừng' : 'Sẵn sàng'}
        </div>
        <div className="digits">{formatted}</div>
        <div className="units" aria-hidden="true">
          <span>GIỜ</span><span>PHÚT</span><span>GIÂY</span>
        </div>
      </>
    );
  }

  return (
    <div className="timer-card">
      <progress
        max={1}
        value={durationMs > 0 ? Math.min(1, Math.max(0, valueMs / durationMs)) : 0}
        aria-label="Thời gian còn lại"
      />
      <div className={`digits${ended ? ' ended' : ''}`}>{formatted}</div>
      <div className="end-label" role="status" hidden={!ended}>Hết giờ</div>
      <p className="selected-duration">Thời lượng đã chọn: {formatDisplayDuration(durationMs, 'up')}</p>
    </div>
  );
}
