import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';

/** "Cetak struk" toggle (K-06/K-07). Default on, remembered per device; printing itself is M-11. */
export function PrintToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Cetak struk</Text>
        <Text style={styles.sub}>
          {value ? 'Struk dicetak otomatis setelah lunas' : 'Struk tidak dicetak'}
        </Text>
      </View>
      <Switch
        testID="print-toggle"
        accessibilityLabel="Cetak struk"
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.green, false: colors.line }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    padding: space.s3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { color: colors.ink, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12 },
});
