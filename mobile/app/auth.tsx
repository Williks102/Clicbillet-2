import { useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { GOOGLE_WEB_CLIENT_ID } from "../lib/config";
import { colors } from "../lib/theme";
import { Button, ErrorText, Field } from "../lib/ui";

type Mode = "login" | "register" | "mfa" | "forgot" | "sent" | "resetSent";

const MIN_PASSWORD = 10; // aligné sur server/lib/validators.ts
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export default function Auth() {
  const router = useRouter();
  const { login, verifyMfa, register, forgotPassword, resendConfirmation, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = () => router.replace("/(tabs)");

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  const submitLogin = () => run(async () => {
    if (!EMAIL_RE.test(email.trim())) throw new Error("Saisissez une adresse e-mail valide.");
    if (!password) throw new Error("Saisissez votre mot de passe.");
    if ((await login(email, password)) === "mfa") return switchMode("mfa");
    go();
  });

  const submitMfa = () => run(async () => {
    await verifyMfa(code.trim());
    go();
  });

  const submitRegister = () => run(async () => {
    if (name.trim().length < 2) throw new Error("Saisissez votre nom (2 caractères minimum).");
    if (!EMAIL_RE.test(email.trim())) throw new Error("Saisissez une adresse e-mail valide.");
    if (password.length < MIN_PASSWORD) throw new Error(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
    if (password !== confirm) throw new Error("Les deux mots de passe ne correspondent pas.");
    await register(name, email, password);
    setMode("sent");
  });

  const submitForgot = () => run(async () => {
    if (!EMAIL_RE.test(email.trim())) throw new Error("Saisissez une adresse e-mail valide.");
    await forgotPassword(email);
    setMode("resetSent");
  });

  const resend = () => run(async () => {
    await resendConfirmation(email);
    setInfo("E-mail renvoyé. Pensez à vérifier vos courriers indésirables.");
  });

  const google = () => run(async () => {
    const r = await loginWithGoogle();
    if (r === "mfa") return switchMode("mfa");
    if (r === "ok") go();
  });

  const isTabs = mode === "login" || mode === "register";

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Image source={require("../assets/splash-logo.png")} style={s.logo} />
            <Text style={s.brand}>ClicBillet</Text>
            <Text style={s.tag}>La billetterie ivoirienne</Text>
          </View>

          <View style={s.card}>
            {isTabs && (
              <View style={s.tabs}>
                {(["login", "register"] as const).map((m) => (
                  <Pressable key={m} style={[s.tab, mode === m && s.tabOn]} onPress={() => switchMode(m)}>
                    <Text style={[s.tabText, mode === m && s.tabTextOn]}>{m === "login" ? "Connexion" : "Inscription"}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <ErrorText message={error} />
            {info && <Text style={s.info}>{info}</Text>}

            {mode === "login" && (
              <>
                <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
                <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
                <Text style={s.link} onPress={() => switchMode("forgot")}>Mot de passe oublié ?</Text>
                <Button title="Se connecter" onPress={submitLogin} loading={busy} />
              </>
            )}

            {mode === "register" && (
              <>
                <Field label="Nom complet" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" />
                <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
                <Field label={`Mot de passe (${MIN_PASSWORD} caractères minimum)`} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
                <Field label="Confirmer le mot de passe" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
                <Button title="Créer mon compte" onPress={submitRegister} loading={busy} />
                <Text style={s.legal}>Vous souhaitez organiser des événements ? Créez d'abord votre compte, puis faites la demande depuis le site.</Text>
              </>
            )}

            {mode === "mfa" && (
              <>
                <Text style={s.lead}>Saisissez le code à 6 chiffres de votre application d'authentification.</Text>
                <Field label="Code de vérification" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
                <Button title="Vérifier" onPress={submitMfa} loading={busy} />
                <Text style={s.link} onPress={() => switchMode("login")}>Retour</Text>
              </>
            )}

            {mode === "forgot" && (
              <>
                <Text style={s.lead}>Indiquez votre e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.</Text>
                <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
                <Button title="Envoyer le lien" onPress={submitForgot} loading={busy} />
                <Text style={s.link} onPress={() => switchMode("login")}>Retour à la connexion</Text>
              </>
            )}

            {mode === "sent" && (
              <>
                <Text style={s.title}>Vérifiez votre boîte mail</Text>
                <Text style={s.lead}>Un e-mail de confirmation vient d'être envoyé à {email.trim()}. Cliquez sur le lien qu'il contient, puis connectez-vous.</Text>
                <Button title="Renvoyer l'e-mail" variant="ghost" onPress={resend} loading={busy} />
                <View style={{ height: 10 }} />
                <Button title="J'ai confirmé, me connecter" onPress={() => { setPassword(""); switchMode("login"); }} />
              </>
            )}

            {mode === "resetSent" && (
              <>
                <Text style={s.title}>E-mail envoyé</Text>
                <Text style={s.lead}>Si un compte existe pour {email.trim()}, vous allez recevoir un lien de réinitialisation. Ouvrez-le depuis votre téléphone ou votre ordinateur.</Text>
                <Button title="Retour à la connexion" onPress={() => switchMode("login")} />
              </>
            )}

            {isTabs && GOOGLE_WEB_CLIENT_ID !== "" && (
              <>
                <View style={s.or}><View style={s.line} /><Text style={s.orText}>ou</Text><View style={s.line} /></View>
                <Pressable style={s.google} onPress={google} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.text} /> : <Text style={s.googleText}>Continuer avec Google</Text>}
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  header: { alignItems: "center", paddingTop: 20, paddingBottom: 28 },
  logo: { width: 84, height: 84 },
  brand: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 4 },
  tag: { color: "#ffedd5", fontSize: 14, marginTop: 2 },
  card: { flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 40 },
  tabs: { flexDirection: "row", backgroundColor: colors.border, borderRadius: 12, padding: 4, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  tabOn: { backgroundColor: "#fff" },
  tabText: { color: colors.muted, fontWeight: "700" },
  tabTextOn: { color: colors.primary },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, marginBottom: 8 },
  lead: { color: colors.muted, lineHeight: 21, marginBottom: 16 },
  info: { color: colors.success, marginBottom: 12 },
  link: { color: colors.primary, fontWeight: "600", textAlign: "center", marginVertical: 12 },
  legal: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 14, lineHeight: 17 },
  or: { flexDirection: "row", alignItems: "center", marginVertical: 18, gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.muted },
  google: { borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  googleText: { color: colors.text, fontWeight: "700", fontSize: 16 },
});
