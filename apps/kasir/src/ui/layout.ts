/** Largest font multiplier for big numbers, keys, buttons and tab labels. Body copy stays uncapped. */
export const FONT_CAP = 1.3;

/** Content never grows wider than this (dp); on tablets it is centred instead. */
export const MAX_CONTENT_WIDTH = 480;

export const KEY_MIN = 40;
export const KEY_MAX = 64;
export const KEY_GAP = 10;

/** TopBar is `minHeight: 56`; its title font is capped so it stays at that height. */
export const TOPBAR_HEIGHT = 56;

/** Tab bar content height (dp) above the bottom inset. */
export const TAB_BAR_TALL = 64;
export const TAB_BAR_SHORT = 56;
const TAB_BAR_SHORT_BELOW = 700;

/**
 * - `full`: normal layout, quick chips visible.
 * - `compact`: chips hidden, amount box condensed.
 * - `scroll`: compact, and the footer moves into the scroll area so every key stays reachable.
 */
export type FooterMode = 'full' | 'compact' | 'scroll';

export interface FooterFitInput {
  /** Height available below the TopBar, from {@link availableHeight}. */
  available: number;
  /** Measured footer height without the keypad, laid out in `full` mode. */
  chromeFull: number;
  /** Same, laid out in `compact`/`scroll` mode (amount box condensed). */
  chromeCompact: number;
  /** Body height we want to keep visible next to the footer in `full` mode. */
  bodyReserve: number;
  /** Same, once chips and secondary text are hidden. */
  compactBodyReserve: number;
}

const MODE_ORDER: Record<FooterMode, number> = { full: 0, compact: 1, scroll: 2 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Window height minus system bars and the TopBar: the room a screen really has. */
export function availableHeight(
  frameHeight: number,
  insetTop: number,
  insetBottom: number,
  topBarHeight: number = TOPBAR_HEIGHT,
): number {
  return Math.max(0, frameHeight - insetTop - insetBottom - topBarHeight);
}

/** Unclamped key height for the room left for four rows (3 gaps). Can be below KEY_MIN. */
export function rawKeyHeight(spaceForKeypad: number): number {
  return Math.floor((spaceForKeypad - 3 * KEY_GAP) / 4);
}

/** Key height for the room left for the keypad, clamped to 40..64 dp. */
export function keyHeightFor(spaceForKeypad: number): number {
  return clamp(rawKeyHeight(spaceForKeypad), KEY_MIN, KEY_MAX);
}

export function keypadHeight(keyHeight: number): number {
  return keyHeight * 4 + KEY_GAP * 3;
}

/** Best mode whose keys fit at {@link KEY_MIN} or more, judged from per-mode measurements. */
export function footerMode(input: FooterFitInput): FooterMode {
  if (rawKeyHeight(input.available - input.chromeFull - input.bodyReserve) >= KEY_MIN)
    return 'full';
  if (rawKeyHeight(input.available - input.chromeCompact - input.compactBodyReserve) >= KEY_MIN)
    return 'compact';
  return 'scroll';
}

/**
 * Next mode given the current one. It only ever degrades (full → compact → scroll) for the same
 * `available`, so a layout change caused by switching mode can never switch it back and forth.
 */
export function nextFooterMode(current: FooterMode, input: FooterFitInput): FooterMode {
  const wanted = footerMode(input);
  return MODE_ORDER[wanted] > MODE_ORDER[current] ? wanted : current;
}

export function shouldScrollFooter(input: FooterFitInput): boolean {
  return footerMode(input) === 'scroll';
}

/** Key height to render in a given mode. `scroll` always uses the minimum. */
export function keyHeightForMode(input: FooterFitInput, mode: FooterMode): number {
  if (mode === 'scroll') return KEY_MIN;
  const compact = mode === 'compact';
  const chrome = compact ? input.chromeCompact : input.chromeFull;
  const reserve = compact ? input.compactBodyReserve : input.bodyReserve;
  return keyHeightFor(input.available - chrome - reserve);
}

export function contentMaxWidth(windowWidth: number): number {
  return Math.min(windowWidth, MAX_CONTENT_WIDTH);
}

export function tabBarContentHeight(frameHeight: number): number {
  return frameHeight < TAB_BAR_SHORT_BELOW ? TAB_BAR_SHORT : TAB_BAR_TALL;
}
