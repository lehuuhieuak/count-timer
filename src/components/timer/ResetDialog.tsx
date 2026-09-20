import { useEffect, useRef } from 'react';

type ResetDialogProps = {
  open: boolean;
  formattedValue: string;
  confirmDisabled: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ResetDialog({ open, formattedValue, confirmDisabled, error, onCancel, onConfirm }: ResetDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <dialog ref={dialogRef} aria-labelledby="reset-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h2 id="reset-title">Đặt lại đồng hồ về 00:00:00?</h2>
      <p>Thời gian đã đếm <strong>{formattedValue}</strong> sẽ được đưa về 0. Thao tác này không thể hoàn tác.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="actions">
        <button ref={cancelRef} type="button" onClick={onCancel}>Hủy bỏ</button>
        <button type="button" className="danger" disabled={confirmDisabled} onClick={onConfirm}>Xác nhận đặt lại</button>
      </div>
    </dialog>
  );
}
