import { Redirect } from 'expo-router';
import { useSession } from '../src/auth/SessionProvider';

/** Entry route: send the user to the first step that applies (pairing → login → open shift → tabs). */
export default function Index() {
  const { paired, session, shift } = useSession();
  if (!paired) return <Redirect href="/pairing" />;
  if (!session) return <Redirect href="/login" />;
  if (!shift) return <Redirect href="/open-shift" />;
  return <Redirect href="/jual" />;
}
