import { touch } from '../theme';

/** Below this window height (dp) the screens use compact keys and type so the pinned footer fits. */
export const COMPACT_HEIGHT = 700;
export const COMPACT_KEY = 48;

export function isCompactHeight(height: number): boolean {
  return height < COMPACT_HEIGHT;
}

export function keyHeightFor(height: number): number {
  return isCompactHeight(height) ? COMPACT_KEY : touch.key;
}
