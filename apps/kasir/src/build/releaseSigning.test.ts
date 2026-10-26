import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { applyReleaseSigning } = createRequire(import.meta.url)(
  '../../plugins/withReleaseSigning.js',
) as { applyReleaseSigning: (gradle: string) => string };

// Excerpt of android/app/build.gradle from expo-template-bare-minimum (SDK 58).
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}`;

describe('withReleaseSigning config plugin', () => {
  it('signs release with the keystore from the environment, debug key otherwise', () => {
    const out = applyReleaseSigning(TEMPLATE);
    expect(out).toContain('storeFile file(keystore)');
    expect(out).toContain("System.getenv('KASIR_KEYSTORE_PASSWORD')");
    expect(out).toContain(
      "signingConfig System.getenv('KASIR_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    // The debug build type keeps the debug key.
    expect(out).toMatch(/debug \{\s*signingConfig signingConfigs\.debug\s*\}/);
  });

  it('is idempotent and fails loudly on an unknown template', () => {
    const once = applyReleaseSigning(TEMPLATE);
    expect(applyReleaseSigning(once)).toBe(once);
    expect(() => applyReleaseSigning('android {}')).toThrow(/signingConfigs\.debug/);
  });
});
