// Bluetooth permissions for the ESC/POS thermal printer (Bluetooth Classic / SPP).
//  - Android 12+ (API 31+): BLUETOOTH_CONNECT + BLUETOOTH_SCAN. SCAN is declared `neverForLocation`
//    so no location permission is needed to find the printer.
//  - Android 11 and older: legacy BLUETOOTH/BLUETOOTH_ADMIN, and location for discovery.
const { withAndroidManifest } = require('expo/config-plugins');

const LEGACY = [
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.ACCESS_FINE_LOCATION',
];

function withBluetooth(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
    const wanted = [
      ...LEGACY.map((name) => ({ $: { 'android:name': name, 'android:maxSdkVersion': '30' } })),
      { $: { 'android:name': 'android.permission.BLUETOOTH_CONNECT' } },
      {
        $: {
          'android:name': 'android.permission.BLUETOOTH_SCAN',
          'android:usesPermissionFlags': 'neverForLocation',
          'tools:targetApi': 's',
        },
      },
    ];
    const existing = manifest['uses-permission'] ?? [];
    const names = new Set(wanted.map((p) => p.$['android:name']));
    manifest['uses-permission'] = [
      ...existing.filter((p) => !names.has(p.$['android:name'])),
      ...wanted,
    ];
    return cfg;
  });
}

module.exports = withBluetooth;
