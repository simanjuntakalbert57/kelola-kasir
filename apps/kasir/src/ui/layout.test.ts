import { describe, expect, it } from 'vitest';
import {
  availableHeight,
  contentMaxWidth,
  footerMode,
  keyHeightFor,
  keyHeightForMode,
  keypadHeight,
  KEY_MAX,
  KEY_MIN,
  MAX_CONTENT_WIDTH,
  shouldScrollFooter,
  tabBarContentHeight,
  type FooterFitInput,
} from './layout';

const fit = (available: number, chrome = 210): FooterFitInput => ({
  available,
  chrome,
  bodyReserve: 200,
  compactBodyReserve: 150,
});

describe('availableHeight', () => {
  it('subtracts system insets and the TopBar from the frame', () => {
    expect(availableHeight(640, 24, 48, 56)).toBe(512);
    expect(availableHeight(915, 32, 24)).toBe(915 - 32 - 24 - 56);
  });

  it('never goes negative', () => {
    expect(availableHeight(100, 50, 50, 56)).toBe(0);
  });
});

describe('keyHeightFor', () => {
  it('clamps to 40..64 dp', () => {
    expect(keyHeightFor(10_000)).toBe(KEY_MAX);
    expect(keyHeightFor(0)).toBe(KEY_MIN);
    expect(keyHeightFor(-50)).toBe(KEY_MIN);
  });

  it('scales with the space left for four rows and three gaps', () => {
    expect(keyHeightFor(4 * 52 + 30)).toBe(52);
    expect(keyHeightFor(4 * 44 + 30)).toBe(44);
  });
});

describe('footerMode', () => {
  it('keeps the full layout when keys fit at 40 dp or more', () => {
    expect(footerMode(fit(616))).toBe('full'); // 360x720 gesture
    expect(footerMode(fit(915 - 32 - 24 - 56))).toBe('full'); // 412x915
    expect(footerMode(fit(1280 - 32 - 24 - 56))).toBe('full'); // tablet
  });

  it('drops chips and condenses the amount box before scrolling', () => {
    // full needs 210 + 200 + 30 + 160 = 600; compact needs 186 + 150 + 30 + 160 = 526
    expect(footerMode(fit(599))).toBe('compact');
    expect(footerMode(fit(526))).toBe('compact');
  });

  it('falls back to a scrolling footer when even compact keys do not fit', () => {
    expect(footerMode(fit(525))).toBe('scroll');
    expect(footerMode(fit(512))).toBe('scroll'); // 360x640 with 3-button nav
    expect(shouldScrollFooter(fit(512))).toBe(true);
    expect(shouldScrollFooter(fit(616))).toBe(false);
  });

  it('degrades earlier when a large font makes the footer taller', () => {
    expect(footerMode(fit(616, 210))).toBe('full');
    expect(footerMode(fit(616, 260))).toBe('compact');
    expect(footerMode(fit(616, 330))).toBe('scroll');
  });

  it('copes with an absurdly small area', () => {
    expect(footerMode(fit(0))).toBe('scroll');
  });
});

describe('keyHeightForMode', () => {
  it('uses the minimum when the footer scrolls', () => {
    expect(keyHeightForMode(fit(400), 'scroll')).toBe(KEY_MIN);
  });

  it('never goes below 40 dp in a mode that was chosen because keys fit', () => {
    for (const available of [526, 560, 616, 700, 900]) {
      const mode = footerMode(fit(available));
      expect(keyHeightForMode(fit(available), mode)).toBeGreaterThanOrEqual(KEY_MIN);
    }
  });

  it('gives bigger keys on bigger screens, capped at 64 dp', () => {
    const small = keyHeightForMode(fit(616), 'full');
    const large = keyHeightForMode(fit(830), 'full');
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(KEY_MAX);
  });

  it('keeps the whole keypad inside the room it was given', () => {
    const input = fit(616);
    const key = keyHeightForMode(input, 'full');
    expect(input.chrome + input.bodyReserve + keypadHeight(key)).toBeLessThanOrEqual(616);
  });
});

describe('contentMaxWidth', () => {
  it('fills phones and caps tablets at 480 dp', () => {
    expect(contentMaxWidth(360)).toBe(360);
    expect(contentMaxWidth(412)).toBe(412);
    expect(contentMaxWidth(800)).toBe(MAX_CONTENT_WIDTH);
  });
});

describe('tabBarContentHeight', () => {
  it('uses a shorter bar on short screens', () => {
    expect(tabBarContentHeight(640)).toBe(56);
    expect(tabBarContentHeight(915)).toBe(64);
  });
});
