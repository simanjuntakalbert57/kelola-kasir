/** Dark theme tokens (v3) from docs/design/design.css (DEAR-5). */
export const colors = {
  bg: '#0E1512',
  surface: '#18221D',
  surfaceAlt: '#1F2D26',
  line: '#2A3831',
  ink: '#EAF2ED',
  muted: '#9DB0A5',
  green: '#15803D',
  greenText: '#6FD3A0',
  greenBg: '#1E3A2D',
  orange: '#C75F12',
  orangeBg: '#3A2616',
  danger: '#FF8A80',
  dangerBg: '#3B1E1C',
  warn: '#F2C26B',
  warnBg: '#3A2E14',
  info: '#8FB2FF',
  infoBg: '#1B2A4A',
  scrim: 'rgba(0,0,0,0.67)',
} as const;

export const radius = { sm: 10, md: 16, lg: 24 } as const;
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32 } as const;

/** Touch targets: >=48 everywhere, 56 for primary actions. */
export const touch = { min: 48, primary: 56, key: 60 } as const;
