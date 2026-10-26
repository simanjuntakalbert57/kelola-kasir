// Bluetooth permissions for the ESC/POS thermal printer (Bluetooth Classic / SPP).
//  - Android 12+ (API 31+): BLUETOOTH_CONNECT + BLUETOOTH_SCAN. SCAN is declared `neverForLocation`
//    so no location permission is needed to find the printer.
//  - Android 11 and older: legacy BLUETOOTH/BLUETOOTH_ADMIN, and location for discovery.
// It also turns on BuildConfig generation for react-native-bluetooth-classic: the library imports
// its own BuildConfig, which AGP 8+ no longer generates for libraries by default.
const { withAndroidManifest, withProjectBuildGradle } = require('expo/config-plugins');

const LEGACY = [
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.ACCESS_FINE_LOCATION',
];

const BUILD_CONFIG_MARKER = '// kelola-kasir: bluetooth-classic BuildConfig';

const BUILD_CONFIG = `
${BUILD_CONFIG_MARKER}
subprojects { project ->
    if (project.name == 'react-native-bluetooth-classic') {
        project.plugins.withId('com.android.library') {
            project.android.buildFeatures.buildConfig = true
        }
    }
}
`;

function applyBluetoothBuildConfig(gradle) {
  return gradle.includes(BUILD_CONFIG_MARKER) ? gradle : `${gradle.trimEnd()}\n${BUILD_CONFIG}`;
}

function withBluetoothPermissions(config) {
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

function withBluetooth(config) {
  config = withBluetoothPermissions(config);
  return withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyBluetoothBuildConfig(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withBluetooth;
module.exports.applyBluetoothBuildConfig = applyBluetoothBuildConfig;
