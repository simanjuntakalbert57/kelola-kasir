import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  availableHeight,
  COMPACT_AMOUNT_SAVING,
  footerMode,
  keyHeightForMode,
  keypadHeight,
  type FooterMode,
} from './layout';

interface Options {
  /** Footer height without the keypad, used until the real one is measured. */
  chromeEstimate: number;
  bodyReserve: number;
  compactBodyReserve: number;
  /** Freeze the mode (e.g. while the IME is open and the keypad is hidden). */
  frozen?: boolean;
}

/**
 * Sizes the keypad from the room that is really available (frame − insets − TopBar), using the
 * measured footer height so font scale and OEM skins are accounted for.
 */
export function useKeypadFit({ chromeEstimate, bodyReserve, compactBodyReserve, frozen }: Options) {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const available = availableHeight(frame.height, insets.top, insets.bottom);

  const [mode, setMode] = useState<FooterMode>('full');
  const [measured, setMeasured] = useState<number | null>(null);
  const rendered = useRef({ keypad: 0, mode, frozen: !!frozen });

  // Measured footers reflect the mode they were laid out in; convert back to the `full` height.
  const chromeFull =
    measured === null
      ? chromeEstimate
      : measured + (rendered.current.mode === 'full' ? 0 : COMPACT_AMOUNT_SAVING);
  const input = { available, chrome: chromeFull, bodyReserve, compactBodyReserve };
  const wanted = footerMode(input);

  useEffect(() => {
    if (!frozen) setMode(wanted);
  }, [wanted, frozen]);

  const keyHeight = keyHeightForMode(input, mode);
  rendered.current = { keypad: keypadHeight(keyHeight), mode, frozen: !!frozen };

  const onFooterLayout = useCallback((e: LayoutChangeEvent) => {
    const { keypad, frozen: isFrozen } = rendered.current;
    if (isFrozen) return;
    const chrome = Math.round(e.nativeEvent.layout.height - keypad);
    setMeasured((prev) => (prev === chrome ? prev : chrome));
  }, []);

  return {
    mode,
    keyHeight,
    compact: mode !== 'full',
    scrollAll: mode === 'scroll',
    onFooterLayout,
  };
}
