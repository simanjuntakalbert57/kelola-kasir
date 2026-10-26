import { Linking, Share } from 'react-native';

/** Digital receipt (M-11): opens WhatsApp with the plain-text receipt, or the system share sheet. */
export async function shareReceiptText(text: string): Promise<void> {
  const url = `whatsapp://send?text=${encodeURIComponent(text)}`;
  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // WhatsApp missing: fall through to the generic share sheet.
  }
  await Share.share({ message: text });
}
