/**
 * API base URL. Defaults to the Prism mock (`pnpm mock`, served without the `/v1` prefix) as seen
 * from the Android emulator. Override with EXPO_PUBLIC_API_URL for a real device or the real API
 * (e.g. http://host:3000/v1).
 */
export const API_BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:4010';

export const APP_VERSION = '0.2.1';

/** PIN rules (TDD §2.3): 6 digits, 5 wrong attempts lock the employee on this device for 5 minutes. */
export const PIN_LENGTH = 6;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 5 * 60 * 1000;

/** True in staging APKs (CI sets EXPO_PUBLIC_APP_VARIANT=staging); used to surface raw errors for bug reports. */
export const IS_STAGING = process.env['EXPO_PUBLIC_APP_VARIANT'] === 'staging';
