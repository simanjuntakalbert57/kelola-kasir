/** Largest font multiplier for big numbers, keys, buttons and tab labels. Body copy stays uncapped. */
export const FONT_CAP = 1.3;

/** Content never grows wider than this (dp); on tablets it is centred instead. */
export const MAX_CONTENT_WIDTH = 480;

export const KEY_MIN = 40;
export const KEY_MAX = 64;
export const KEY_GAP = 10;

/** TopBar is `minHeight: 56`; its title font is capped so it stays at that height. */
export const TOPBAR_HEIGHT = 56;

/** Height (dp) the compact amount box saves versus the full one. */
export const COMPACT_AMOUNT_SAVING = 24;

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
  /** Measured height of the footer without the keypad (amount box, buttons, padding). */
  chrome: number;
  /** Body height we want to keep visible next to the footer in `full` mode. */
  bodyReserve: number;
  /** Same, once chips and secondary text are hidden. */
  compactBodyReserve: number;
  /** What the amount box saves when condensed; defaults to {@link COMPACT_AMOUNT_SAVING}. */
  compactSaving?: number;
}

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

export function footerMode(input: FooterFitInput): FooterMode {
  const saving = input.compactSaving ?? COMPACT_AMOUNT_SAVING;
  if (rawKeyHeight(input.available - input.chrome - input.bodyReserve) >= KEY_MIN) return 'full';
  if (rawKeyHeight(input.available - (input.chrome - saving) - input.compactBodyReserve) >= KEY_MIN)
    return 'compact';
  return 'scroll';
}

export function shouldScrollFooter(input: FooterFitInput): boolean {
  return footerMode(input) === 'scroll';
}

/** Key height to render in a given mode. `scroll` always uses the minimum. */
export function keyHeightForMode(input: FooterFitInput, mode: FooterMode): number {
  if (mode === 'scroll') return KEY_MIN;
  const saving = mode === 'compact' ? (input.compactSaving ?? COMPACT_AMOUNT_SAVING) : 0;
  const reserve = mode === 'compact' ? input.compactBodyReserve : input.bodyReserve;
  return keyHeightFor(input.available - (input.chrome - saving) - reserve);
}

export function contentMaxWidth(windowWidth: number): number {
  return Math.min(windowWidth, MAX_CONTENT_WIDTH);
}

export function tabBarContentHeight(frameHeight: number): number {
  return frameHeight < TAB_BAR_SHORT_BELOW ? TAB_BAR_SHORT : TAB_BAR_TALL;
}
