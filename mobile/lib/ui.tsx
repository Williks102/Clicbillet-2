import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";
import { colors, radius } from "./theme";

export function Button({ title, onPress, loading, variant = "primary", disabled }: {
  title: string; onPress: () => void; loading?: boolean; variant?: "primary" | "ghost"; disabled?: boolean;
}) {
  const ghost = variant === "ghost";
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={({ pressed }) => [s.btn, ghost && s.btnGhost, (pressed || disabled) && { opacity: 0.7 }]}
    >
      {loading ? <ActivityIndicator color={ghost ? colors.primary : "#fff"} /> : (
        <Text style={[s.btnText, ghost && { color: colors.primary }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} autoCapitalize="none" style={s.input} {...rest} />
    </View>
  );
}

export function ErrorText({ message }: { message?: string | null }) {
  return message ? <Text style={s.error}>{message}</Text> : null;
}

export function Empty({ text }: { text: string }) {
  return <View style={{ padding: 40, alignItems: "center" }}><Text style={{ color: colors.muted, textAlign: "center" }}>{text}</Text></View>;
}

const s = StyleSheet.create({
  btn: { backgroundColor: colors.primary, borderRadius: radius, paddingVertical: 14, alignItems: "center" },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.primary },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 16, color: colors.text },
  error: { color: colors.danger, marginBottom: 12 },
});
