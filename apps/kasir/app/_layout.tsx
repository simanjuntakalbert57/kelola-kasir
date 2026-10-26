import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../src/auth/SessionProvider';
import { colors } from '../src/theme';

function Routes() {
  const { boot, paired, session, shift } = useSession();
  if (boot === 'booting') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.greenText} />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!paired}>
        <Stack.Screen name="pairing" />
      </Stack.Protected>
      <Stack.Protected guard={!!paired && !session}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={!!session && !shift}>
        <Stack.Screen name="open-shift" />
      </Stack.Protected>
      <Stack.Protected guard={!!session && !!shift}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Routes />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
