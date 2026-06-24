import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors, fonts, radius } from '../theme';

type Props = TextInputProps & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
};

export function FieldRow({ label, value, onChangeText, placeholder, ...props }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedText}
        style={[styles.input, props.multiline && styles.multiline]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8
  },
  label: {
    color: colors.charcoal,
    fontSize: 14,
    fontFamily: fonts.extraBold
  },
  input: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.charcoal
  },
  multiline: {
    paddingTop: 14,
    minHeight: 96,
    textAlignVertical: 'top'
  }
});
