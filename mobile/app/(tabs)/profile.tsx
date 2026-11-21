import { Linking, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SITE_URL, appVersion } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { colors, radius } from "../../lib/theme";
import { Button } from "../../lib/ui";

const ROLES = { client: "Acheteur", organizer: "Organisateur", admin: "Administrateur" } as const;

export default function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <View style={{ padding: 16, gap: 14 }}>
      {user ? (
        <>
          <View style={s.card}>
            <Text style={s.name}>{user.name}</Text>
            <Text style={s.meta}>{user.email}</Text>
            <Text style={s.meta}>{ROLES[user.role]}{user.publicCode ? ` · ${user.publicCode}` : ""}</Text>
          </View>
          {user.role !== "client" && (
            <Button title="Tableau de bord sur le web" variant="ghost" onPress={() => Linking.openURL(SITE_URL)} />
          )}
          <Button title="Se déconnecter" onPress={logout} />
        </>
      ) : (
        <Button title="Se connecter" onPress={() => router.push("/login")} />
      )}
      <Text style={s.version}>ClicBillet v{appVersion}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius, padding: 16, borderWidth: 1, borderColor: colors.border },
  name: { fontSize: 20, fontWeight: "800", color: colors.text },
  meta: { color: colors.muted, marginTop: 4 },
  version: { textAlign: "center", color: colors.muted, marginTop: 20, fontSize: 12 },
});
