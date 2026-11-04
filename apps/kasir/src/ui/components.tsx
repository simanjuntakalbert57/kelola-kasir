import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space, touch } from '../theme';
import { FONT_CAP, MAX_CONTENT_WIDTH } from './layout';

type ButtonVariant = 'primary' | 'accent' | 'outline' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'outline',
  large,
  disabled,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  large?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const bg =
    variant === 'primary' ? colors.green : variant === 'accent' ? colors.orange : colors.surface;
  const fg = variant === 'primary' || variant === 'accent' ? '#fff' : colors.greenText;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: variant === 'ghost' ? 'transparent' : bg,
          minHeight: large ? touch.primary : touch.min,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          borderColor: variant === 'outline' ? colors.line : 'transparent',
        },
        style,
      ]}
    >
      <Text
        maxFontSizeMultiplier={FONT_CAP}
        style={[styles.btnText, { color: fg, fontSize: large ? 18 : 16 }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      style={[styles.chip, on && { backgroundColor: colors.green, borderColor: colors.green }]}
    >
      <Text style={[styles.chipText, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'error' | 'info';
  children: ReactNode;
}) {
  const map = {
    warn: [colors.warnBg, colors.warn],
    error: [colors.dangerBg, colors.danger],
    info: [colors.infoBg, colors.info],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="alert">
      <Text style={{ color: fg, fontWeight: '600', fontSize: 14 }}>{children}</Text>
    </View>
  );
}

export function TopBar({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.bar}>
      <Text maxFontSizeMultiplier={FONT_CAP} style={styles.barTitle}>
        {title}
      </Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

/** Centres content at most 480 dp wide, so phones fill the screen and tablets do not stretch. */
export function ScreenContainer({ children }: { children: ReactNode }) {
  return <View style={styles.container}>{children}</View>;
}

/**
 * Body + footer. Normally the footer is pinned under the scrolling body; when it does not fit
 * (`scrollAll`) it moves into the scroll area so the keypad and action buttons stay reachable.
 */
export function FitLayout({
  scrollAll,
  body,
  footer,
  bodyStyle,
}: {
  scrollAll: boolean;
  body: ReactNode;
  footer: ReactNode;
  bodyStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <>
      <ScrollView
        style={styles.fitScroll}
        contentContainerStyle={[styles.fitBody, bodyStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {body}
        {scrollAll ? footer : null}
      </ScrollView>
      {scrollAll ? null : footer}
    </>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;
const KEYS_WITH_000 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'] as const;

/** Numeric keypad; `keyHeight` (40–64) comes from `useKeypadFit`. Blank key (login) or `000` (cash). */
export function Keypad({
  onKey,
  disabled,
  triple,
  keyHeight = touch.key,
}: {
  onKey: (key: string) => void;
  disabled?: boolean;
  triple?: boolean;
  keyHeight?: number;
}) {
  const keys = triple ? KEYS_WITH_000 : KEYS;
  const rows = [keys.slice(0, 3), keys.slice(3, 6), keys.slice(6, 9), keys.slice(9, 12)];
  return (
    <View style={styles.keypad}>
      {rows.map((row, r) => (
        <View key={r} style={styles.keyRow}>
          {row.map((k, i) =>
            k === '' ? (
              <View key={i} style={[styles.keySlot, { minHeight: keyHeight }]} />
            ) : (
              <Pressable
                key={i}
                testID={`key-${k}`}
                accessibilityRole="button"
                accessibilityLabel={k === '⌫' ? 'Hapus' : k}
                disabled={disabled}
                onPress={() => onKey(k)}
                style={({ pressed }) => [
                  styles.keySlot,
                  styles.key,
                  { minHeight: keyHeight, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
                ]}
              >
                <Text maxFontSizeMultiplier={FONT_CAP} style={styles.keyText}>
                  {k}
                </Text>
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

export function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <View style={styles.dots} accessibilityLabel={`${filled} dari ${length} digit`}>
      {Array.from({ length }, (_, i) => (
        <View key={i} style={[styles.dot, i < filled && { backgroundColor: colors.greenText }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  fitScroll: { flex: 1 },
  fitBody: { flexGrow: 1 },
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  btnText: { fontWeight: '700' },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipText: { color: colors.ink, fontWeight: '600', fontSize: 15 },
  banner: { paddingHorizontal: space.s4, paddingVertical: space.s2 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.s4,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  barTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  keypad: { gap: 10 },
  keyRow: { flexDirection: 'row', gap: 10 },
  keySlot: { flex: 1, minHeight: touch.key },
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  keyText: { color: colors.ink, fontSize: 24, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 14, justifyContent: 'center', marginVertical: space.s4 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.greenText,
  },
});

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.s6,
        gap: 10,
      }}
    >
      <Text style={{ fontSize: 48 }}>{icon}</Text>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: colors.muted, textAlign: 'center', lineHeight: 20 }}>{body}</Text>
      {action}
    </View>
  );
}
