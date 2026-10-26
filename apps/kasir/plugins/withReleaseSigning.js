// Release signing for the sideloaded APK (ADR-0011, docs/ops/apk-release.md).
//
// The Expo template signs `release` with the debug key. This plugin adds a `release` signing config
// that reads the owner's upload keystore from environment variables at build time, so the keystore
// and its passwords never enter the repo:
//   KASIR_KEYSTORE_FILE, KASIR_KEYSTORE_PASSWORD, KASIR_KEY_ALIAS, KASIR_KEY_PASSWORD
// Without KASIR_KEYSTORE_FILE the release build keeps the debug key (staging/UAT builds).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// kelola-kasir: release signing';

const RELEASE_SIGNING = `
        ${MARKER}
        release {
            def keystore = System.getenv('KASIR_KEYSTORE_FILE')
            if (keystore) {
                storeFile file(keystore)
                storePassword System.getenv('KASIR_KEYSTORE_PASSWORD')
                keyAlias System.getenv('KASIR_KEY_ALIAS')
                keyPassword System.getenv('KASIR_KEY_PASSWORD')
            }
        }`;

function applyReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  const debugConfig = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
  if (!debugConfig.test(gradle)) {
    throw new Error('withReleaseSigning: signingConfigs.debug not found in app/build.gradle');
  }
  let out = gradle.replace(debugConfig, `$1${RELEASE_SIGNING}`);
  const releaseUsesDebug = /(release\s*\{[^{}]*?)signingConfig signingConfigs\.debug/;
  if (!releaseUsesDebug.test(out)) {
    throw new Error('withReleaseSigning: release build type signing not found in app/build.gradle');
  }
  out = out.replace(
    releaseUsesDebug,
    "$1signingConfig System.getenv('KASIR_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug",
  );
  return out;
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
