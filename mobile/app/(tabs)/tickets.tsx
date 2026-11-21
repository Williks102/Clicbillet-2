import { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate } from "../../lib/format";
import { colors, radius } from "../../lib/theme";
import { Button, Empty, ErrorText } from "../../lib/ui";
import type { Ticket } from "../../lib/types";

export default function Tickets() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      setTickets(await api<Ticket[]>("/api/my-tickets"));
    } catch (e: any) {
      setError(e.message);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!loading && !user) {
    return (
      <View style={{ padding: 24, gap: 12 }}>
        <Empty text="Connectez-vous pour retrouver vos billets." />
        <Button title="Se connecter" onPress={() => router.push("/login")} />
      </View>
    );
  }

  return (
    <FlatList
      data={tickets}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: 16, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={<ErrorText message={error} />}
      ListEmptyComponent={error ? undefined : <Empty text="Vous n'avez pas encore de billet." />}
      renderItem={({ item: t }) => (
        <View style={s.card}>
          <Text style={s.title}>{t.eventTitle}</Text>
          <Text style={s.meta}>{formatDate(t.eventDate, t.eventTime)} · {t.eventVenue}</Text>
          <Text style={s.meta}>{t.tier.toUpperCase()} × {t.quantity}</Text>
          <View style={s.qrBox}>
            {t.scanned ? (
              <Text style={{ color: colors.muted }}>Billet déjà utilisé</Text>
            ) : t.paymentStatus === "pending" ? (
              <Text style={{ color: colors.muted }}>Paiement en attente</Text>
            ) : t.qrCodeData ? (
              <QRCode value={t.qrCodeData} size={200} />
            ) : (
              <Text style={{ color: colors.muted, textAlign: "center" }}>
                QR code disponible à l'approche de l'événement{t.qrUnlocksAt ? `\n(${new Date(t.qrUnlocksAt).toLocaleString("fr-FR")})` : ""}
              </Text>
            )}
          </View>
        </View>
      )}
    />
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius, padding: 16, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  meta: { color: colors.muted, marginTop: 3 },
  qrBox: { alignItems: "center", justifyContent: "center", marginTop: 14, minHeight: 120 },
});
