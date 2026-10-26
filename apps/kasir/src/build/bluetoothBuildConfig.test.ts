import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { applyBluetoothBuildConfig } = createRequire(import.meta.url)(
  '../../plugins/withBluetooth.js',
) as { applyBluetoothBuildConfig: (gradle: string) => string };

const ROOT_GRADLE = `allprojects {
  repositories {
    google()
    mavenCentral()
  }
}
apply plugin: "expo-root-project"
`;

describe('withBluetooth config plugin', () => {
  it('enables BuildConfig only for react-native-bluetooth-classic', () => {
    const out = applyBluetoothBuildConfig(ROOT_GRADLE);
    expect(out.startsWith(ROOT_GRADLE.trimEnd())).toBe(true);
    expect(out).toContain("project.name == 'react-native-bluetooth-classic'");
    expect(out).toContain('project.android.buildFeatures.buildConfig = true');
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = applyBluetoothBuildConfig(ROOT_GRADLE);
    expect(applyBluetoothBuildConfig(once)).toBe(once);
  });
});
