import type { TimerKind } from '../../features/timer/types';

type TimerTabsProps = {
  selected: TimerKind;
  onChange: (kind: TimerKind) => void;
  running: { up: boolean; down: boolean };
};

export function TimerTabs({ selected, onChange, running }: TimerTabsProps) {
  const focusTab = (kind: TimerKind) => {
    onChange(kind);
    document.getElementById(`tab-${kind}`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home'
      ? 'up'
      : event.key === 'End'
        ? 'down'
        : selected === 'up' ? 'down' : 'up';
    focusTab(target);
  };

  return (
    <div className="tabs" role="tablist" aria-label="Chế độ đồng hồ" onKeyDown={onKeyDown}>
      {(['up', 'down'] as const).map((kind) => (
        <button
          key={kind}
          id={`tab-${kind}`}
          type="button"
          role="tab"
          aria-controls={`panel-${kind}`}
          aria-selected={selected === kind}
          tabIndex={selected === kind ? 0 : -1}
          onClick={() => onChange(kind)}
        >
          {kind === 'up' ? 'Đếm lên' : 'Đếm ngược'}
          <span className={`dot${running[kind] ? ' running' : ''}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
