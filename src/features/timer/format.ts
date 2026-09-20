export function formatDuration(ms: number): string {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1_000) : 0;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainingSeconds = seconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}
