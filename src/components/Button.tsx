import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, fonts, radius } from '../theme';

type Props = {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  style?: ViewStyle;
  disabled?: boolean;
};

export function Button({ label, onPress, icon, variant = 'primary', style, disabled = false }: Props) {
  const iconColor = variant === 'primary' || variant === 'danger' ? colors.white : colors.green;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        disabled && styles.disabled,
        pressed && styles.pressed,
        style
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={iconColor} /> : null}
      <Text style={[styles.text, variant !== 'primary' && variant !== 'danger' && styles.textSecondary]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 8
  },
  primary: {
    backgroundColor: colors.green
  },
  secondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.green
  },
  ghost: {
    backgroundColor: colors.greenMist
  },
  danger: {
    backgroundColor: colors.danger
  },
  text: {
    color: colors.white,
    fontSize: 15,
    fontFamily: fonts.extraBold
  },
  textSecondary: {
    color: colors.green
  },
  disabled: {
    opacity: 0.45
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }]
  }
});
