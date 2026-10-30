import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint, isBase64UrlOfLength } from './endpoint.js';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://android.googleapis.com/gcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://abc.push.services.mozilla.com/wpush/v2/abc',
    'https://sg2p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/abc',
    'https://api.push.apple.com/3/device/abc',
    'https://FCM.googleapis.com:443/fcm/send/abc',
  ])('accepts %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x',
    'https://localhost/x',
    'https://evil.example.com/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://notgoogleapis.com/x',
    'https://evilnotify.windows.com.attacker.io/x',
    'ftp://fcm.googleapis.com/x',
    'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
  ])('rejects %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('isBase64UrlOfLength', () => {
  it('checks alphabet and decoded length', () => {
    expect(isBase64UrlOfLength(Buffer.alloc(16, 1).toString('base64url'), 16)).toBe(true);
    expect(isBase64UrlOfLength(Buffer.alloc(15, 1).toString('base64url'), 16)).toBe(false);
    expect(isBase64UrlOfLength('not+base64/url==', 16)).toBe(false);
  });
});
