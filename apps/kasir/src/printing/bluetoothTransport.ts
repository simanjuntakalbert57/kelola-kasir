import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';
import type { PermissionResult, PrinterDevice, PrinterTransport } from './service';

const toDevice = (d: { name: string; address: string; bonded?: unknown }): PrinterDevice => ({
  name: d.name || d.address,
  address: d.address,
  bonded: !!d.bonded,
});

/**
 * Android 12+ asks for `BLUETOOTH_CONNECT` + `BLUETOOTH_SCAN` (declared with `neverForLocation` by
 * `plugins/withBluetooth.js`); Android 11 and older only need location for discovery.
 */
async function requestPermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return 'denied';
  const wanted =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  const values = Object.values(result);
  if (values.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
  return values.includes(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? 'blocked' : 'denied';
}

/** Bluetooth Classic (SPP/RFCOMM): the RPP02N is not BLE, so a BLE-only library cannot reach it. */
export const bluetoothTransport: PrinterTransport = {
  requestPermissions,
  isEnabled: () => RNBluetoothClassic.isBluetoothEnabled(),
  listBonded: async () => (await RNBluetoothClassic.getBondedDevices()).map(toDevice),
  discover: async (onFound) => {
    const sub = RNBluetoothClassic.onDeviceDiscovered((e) => onFound(toDevice(e.device)));
    try {
      await RNBluetoothClassic.startDiscovery();
    } finally {
      sub.remove();
    }
  },
  cancelDiscovery: async () => {
    await RNBluetoothClassic.cancelDiscovery().catch(() => false);
  },
  pair: async (address) => {
    await RNBluetoothClassic.pairDevice(address);
  },
  connect: async (address) => {
    // Raw binary out, nothing to parse in: no delimiter, no charset conversion.
    await RNBluetoothClassic.connectToDevice(address, { delimiter: '', charset: 'latin1' });
  },
  isConnected: (address) => RNBluetoothClassic.isDeviceConnected(address),
  disconnect: async (address) => {
    await RNBluetoothClassic.disconnectFromDevice(address);
  },
  write: async (address, data) => {
    await RNBluetoothClassic.writeToDevice(address, Buffer.from(data));
  },
  onDisconnected: (listener) => {
    const sub = RNBluetoothClassic.onDeviceDisconnected((e) => listener(e.device.address));
    return () => sub.remove();
  },
  openSettings: () => RNBluetoothClassic.openBluetoothSettings(),
};
