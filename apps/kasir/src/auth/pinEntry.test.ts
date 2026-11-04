import { describe, expect, it, vi } from 'vitest';
import { createPinEntry } from './pinEntry';

const setup = () => {
  const onSubmit = vi.fn();
  const onChange = vi.fn();
  const entry = createPinEntry({ length: 6, onChange, onSubmit });
  return { entry, onSubmit, onChange };
};

describe('createPinEntry', () => {
  it('keeps every digit when taps arrive before a re-render and submits once', () => {
    const { entry, onSubmit } = setup();
    for (const k of '123456') entry.press(k);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('ignores extra taps while a submit is in flight (no double login)', () => {
    const { entry, onSubmit } = setup();
    for (const k of '1234567890') entry.press(k);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('handles backspace between rapid taps', () => {
    const { entry, onSubmit } = setup();
    for (const k of '12⌫⌫987654') entry.press(k);
    expect(onSubmit).toHaveBeenCalledWith('987654');
  });

  it('allows a new attempt after clear + release', () => {
    const { entry, onSubmit } = setup();
    for (const k of '111111') entry.press(k);
    entry.clear();
    entry.release();
    for (const k of '222222') entry.press(k);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith('222222');
  });
});
