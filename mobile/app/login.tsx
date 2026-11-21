import { useState } from "react";
import { Linking, ScrollView, Text } from "react-native";
import { useRouter } from "expo-router";
import { SITE_URL } from "../lib/api";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/theme";
import { Button, ErrorText, Field } from "../lib/ui";

export default function Login() {
  const { login, verifyMfa } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (needMfa) {
        await verifyMfa(code.trim());
        router.back();
      } else if ((await login(email, password)) === "mfa") {
        setNeedMfa(true);
      } else {
        router.back();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <ErrorText message={error} />
      {needMfa ? (
        <Field label="Code de double authentification" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
      ) : (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        </>
      )}
      <Button title={needMfa ? "Vérifier" : "Se connecter"} onPress={submit} loading={busy} />
      {!needMfa && (
        <Text style={{ textAlign: "center", marginTop: 18, color: colors.primary, fontWeight: "600" }} onPress={() => Linking.openURL(SITE_URL)}>
          Pas de compte ? Créez-le sur clicbillet.com
        </Text>
      )}
    </ScrollView>
  );
}
