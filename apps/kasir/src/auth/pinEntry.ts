/**
 * Synchronous PIN entry state. The value lives in the controller, not in a React closure, so
 * rapid taps that land before a re-render still append in order and submit exactly once.
 */
export interface PinEntry {
  /** Returns the PIN after the key was applied (for rendering). */
  press(key: string): string;
  clear(): void;
  value(): string;
  /** Allow the next submit after a finished attempt. */
  release(): void;
}

export function createPinEntry(opts: {
  length: number;
  onChange: (pin: string) => void;
  onSubmit: (pin: string) => void;
}): PinEntry {
  let pin = '';
  let submitting = false;
  const set = (next: string) => {
    pin = next;
    opts.onChange(pin);
  };
  return {
    press(key) {
      if (submitting) return pin;
      if (key === '⌫') {
        set(pin.slice(0, -1));
        return pin;
      }
      if (pin.length >= opts.length) return pin;
      set(pin + key);
      if (pin.length === opts.length) {
        submitting = true;
        opts.onSubmit(pin);
      }
      return pin;
    },
    clear() {
      set('');
    },
    value: () => pin,
    release() {
      submitting = false;
    },
  };
}
