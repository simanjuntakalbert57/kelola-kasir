import type { PrinterTransport } from './service';

const unsupported = () => Promise.reject(new Error('Bluetooth printing needs the Android app'));

/** Web preview has no Bluetooth: every call fails like "printer not connected". */
export const bluetoothTransport: PrinterTransport = {
  requestPermissions: () => Promise.resolve('denied'),
  isEnabled: () => Promise.resolve(false),
  listBonded: () => Promise.resolve([]),
  discover: () => Promise.resolve(),
  cancelDiscovery: () => Promise.resolve(),
  pair: unsupported,
  connect: unsupported,
  isConnected: () => Promise.resolve(false),
  disconnect: () => Promise.resolve(),
  write: unsupported,
  onDisconnected: () => () => undefined,
  openSettings: () => undefined,
};
