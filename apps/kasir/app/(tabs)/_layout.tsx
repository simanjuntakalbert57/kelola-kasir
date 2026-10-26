import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { colors } from '../../src/theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.greenText,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 64 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="jual" options={{ title: 'Jual', tabBarIcon: icon('🍹') }} />
      <Tabs.Screen name="riwayat" options={{ title: 'Riwayat', tabBarIcon: icon('🧾') }} />
      <Tabs.Screen name="shift" options={{ title: 'Shift', tabBarIcon: icon('⏱') }} />
    </Tabs>
  );
}
