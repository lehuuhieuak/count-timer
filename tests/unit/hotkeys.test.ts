import { describe, expect, it } from 'vitest';

import { isSpaceHotkeyAllowed } from '../../src/hooks/hotkeys';

describe('space hotkey filtering', () => {
  it('handles Space from the page body once', () => {
    expect(
      isSpaceHotkeyAllowed({
        code: 'Space',
        repeat: false,
        isComposing: false,
        targetKind: 'body',
        inDialog: false,
      }),
    ).toBe(true);
  });

  it.each(['input', 'textarea', 'select', 'button', 'contenteditable', 'dialog'])(
    'ignores Space from %s',
    (targetKind) => {
      expect(
        isSpaceHotkeyAllowed({
          code: 'Space',
          repeat: false,
          isComposing: false,
          targetKind: targetKind as 'input',
          inDialog: targetKind === 'dialog',
        }),
      ).toBe(false);
    },
  );

  it('ignores repeated or modified key events', () => {
    expect(
      isSpaceHotkeyAllowed({
        code: 'Space',
        repeat: true,
        isComposing: false,
        targetKind: 'body',
        inDialog: false,
      }),
    ).toBe(false);
    expect(
      isSpaceHotkeyAllowed({
        code: 'Enter',
        repeat: false,
        isComposing: false,
        targetKind: 'body',
        inDialog: false,
      }),
    ).toBe(false);
  });
});
