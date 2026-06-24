import { Alert, Linking, Platform, Share } from 'react-native';
import { AppSettings, CustomerSummary } from '../types';
import { formatNaira } from './money';

export function buildReminderMessage(customer: CustomerSummary, settings: AppSettings) {
  const businessName = settings.businessName?.trim() || 'my shop';
  const ownerName = settings.ownerName?.trim();
  const message = settings.reminderTemplate
    .replace(/\{customerName\}/g, customer.name)
    .replace(/\{balance\}/g, formatNaira(customer.balance))
    .replace(/\{businessName\}/g, businessName)
    .replace(/\{ownerName\}/g, ownerName || businessName);

  const signature = ownerName
    ? `${ownerName}${businessName ? `, ${businessName}` : ''}`
    : businessName;

  return signature && !message.toLowerCase().includes(signature.toLowerCase())
    ? `${message}\n\n${signature}`
    : message;
}

function normalizeNigeriaPhone(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.replace('+', '');
  if (digits.startsWith('0')) return `234${digits.slice(1)}`;
  return digits;
}

export async function openWhatsAppMessage(phoneNumber: string, message: string) {
  const encoded = encodeURIComponent(message);
  const phone = normalizeNigeriaPhone(phoneNumber);
  const url = phone ? `whatsapp://send?phone=${phone}&text=${encoded}` : `whatsapp://send?text=${encoded}`;

  if (Platform.OS === 'web') {
    await Linking.openURL(`https://wa.me/${phone ? phone : ''}?text=${encoded}`);
    return;
  }

  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
    return;
  }

  try {
    await Share.share({ message });
  } catch {
    Alert.alert('Message ready', message);
  }
}

export async function openWhatsAppReminder(customer: CustomerSummary, settings: AppSettings) {
  await openWhatsAppMessage(customer.phone, buildReminderMessage(customer, settings));
}
