import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  availableHeight,
  keyHeightForMode,
  keypadHeight,
  nextFooterMode,
  type FooterFitInput,
  type FooterMode,
} from './layout';

interface Options {
  /** Footer height without the keypad in `full` mode, used until the real one is measured. */
  chromeEstimate: number;
  /** How much shorter the footer gets in compact mode; 0 when nothing in it is condensed. */
  compactSaving: number;
  bodyReserve: number;
  compactBodyReserve: number;
  /** Freeze the mode (e.g. while the IME is open and the keypad is hidden). */
  frozen?: boolean;
}

interface Measured {
  full?: number;
  compact?: number;
}

/**
 * Sizes the keypad from the room that is really available (frame − insets − TopBar), using the
 * measured footer height so font scale and OEM skins are accounted for.
 *
 * The footer is measured separately for `full` and for `compact`/`scroll` (never converted with a
 * constant), and the mode only degrades for a given `available`, so it cannot flip-flop.
 */
export function useKeypadFit({
  chromeEstimate,
  compactSaving,
  bodyReserve,
  compactBodyReserve,
  frozen,
}: Options) {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const available = availableHeight(frame.height, insets.top, insets.bottom);

  const [mode, setMode] = useState<FooterMode>('full');
  const [measured, setMeasured] = useState<Measured>({});
  const rendered = useRef({ keypad: 0, mode, frozen: !!frozen });

  const chromeFull = measured.full ?? chromeEstimate;
  const input: FooterFitInput = {
    available,
    chromeFull,
    chromeCompact: measured.compact ?? chromeFull - compactSaving,
    bodyReserve,
    compactBodyReserve,
  };

  // A new window size, inset or font scale starts over from the full layout.
  const lastAvailable = useRef(available);
  useEffect(() => {
    if (lastAvailable.current === available) return;
    lastAvailable.current = available;
    setMode('full');
  }, [available]);

  // Decide only once the footer was measured in the mode it is currently shown in.
  const known = mode === 'full' ? measured.full : measured.compact;
  const inputKey = JSON.stringify(input);
  useEffect(() => {
    if (frozen || known === undefined) return;
    setMode((current) => nextFooterMode(current, input));
  }, [inputKey, known, frozen]);

  const keyHeight = keyHeightForMode(input, mode);
  rendered.current = { keypad: keypadHeight(keyHeight), mode, frozen: !!frozen };

  const onFooterLayout = useCallback((e: LayoutChangeEvent) => {
    const { keypad, mode: shown, frozen: isFrozen } = rendered.current;
    if (isFrozen) return;
    const chrome = Math.round(e.nativeEvent.layout.height - keypad);
    const slot = shown === 'full' ? 'full' : 'compact';
    setMeasured((prev) => (prev[slot] === chrome ? prev : { ...prev, [slot]: chrome }));
  }, []);

  return {
    mode,
    keyHeight,
    compact: mode !== 'full',
    scrollAll: mode === 'scroll',
    onFooterLayout,
  };
}
