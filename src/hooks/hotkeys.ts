'use client';

import { useEffect } from 'react';

export type HotkeyTargetKind = 'body' | 'input' | 'textarea' | 'select' | 'button' | 'contenteditable' | 'dialog';

export type SpaceHotkeyInput = {
  code: string;
  repeat: boolean;
  isComposing: boolean;
  targetKind: HotkeyTargetKind;
  inDialog: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

export function isSpaceHotkeyAllowed(event: SpaceHotkeyInput): boolean {
  return event.code === 'Space'
    && !event.repeat
    && !event.isComposing
    && !event.inDialog
    && event.targetKind === 'body'
    && !event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && !event.shiftKey;
}

function getTargetKind(target: EventTarget | null): HotkeyTargetKind {
  if (!(target instanceof HTMLElement)) return 'body';
  if (target.closest('dialog')) return 'dialog';
  if (target.closest('input')) return 'input';
  if (target.closest('textarea')) return 'textarea';
  if (target.closest('select')) return 'select';
  if (target.closest('button, a')) return 'button';
  if (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])')) {
    return 'contenteditable';
  }
  return 'body';
}

export function useHotkeys(onToggle: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const inDialog = document.querySelector('dialog[open]') !== null;
      if (!isSpaceHotkeyAllowed({
        code: event.code,
        repeat: event.repeat,
        isComposing: event.isComposing,
        targetKind: getTargetKind(event.target),
        inDialog,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })) {
        return;
      }

      event.preventDefault();
      onToggle();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggle]);
}
