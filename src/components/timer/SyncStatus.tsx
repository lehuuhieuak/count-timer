import type { SyncState } from '../../hooks/useTimers';

export function SyncStatus({ state }: { state: SyncState }) {
  const label = state === 'loading'
    ? 'Đang tải'
    : state === 'saving'
      ? 'Đang lưu'
      : state === 'synced' ? 'Đã đồng bộ' : 'Chưa đồng bộ';
  return <span className="connection" role="status">{label}</span>;
}
