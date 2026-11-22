import { useCallback, useState } from "react";
import { RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { isEventPast } from "../../lib/dates";
import { colors, radius } from "../../lib/theme";
import { Empty, ErrorText } from "../../lib/ui";
import type { Ticket } from "../../lib/types";

export default function Tickets() {
  const { user } = useAuth();
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

  const byDate = (a: Ticket, b: Ticket) => `${a.eventDate}T${a.eventTime}`.localeCompare(`${b.eventDate}T${b.eventTime}`);
  const isPast = (t: Ticket) => isEventPast({ date: t.eventDate, time: t.eventTime });
  const sections = [
    { title: "À venir", data: tickets.filter((t) => !isPast(t)).sort(byDate) },
    { title: "Passés", data: tickets.filter(isPast).sort((a, b) => byDate(b, a)) },
  ].filter((s) => s.data.length > 0);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={<ErrorText message={error} />}
      ListEmptyComponent={error ? undefined : <Empty text="Vous n'avez pas encore de billet." />}
      renderSectionHeader={({ section }) => <Text style={s.section}>{section.title}</Text>}
      renderItem={({ item: t }) => {
        const past = isPast(t);
        return (
          <View style={[s.card, past && { opacity: 0.45 }]}>
            {t.scanned ? (
              <Text style={s.note}>Billet déjà utilisé</Text>
            ) : t.paymentStatus === "pending" ? (
              <Text style={s.note}>Paiement en attente</Text>
            ) : t.qrCodeData ? (
              <QRCode value={t.qrCodeData} size={220} />
            ) : (
              <Text style={s.note}>
                QR code disponible à l'approche de l'événement{t.qrUnlocksAt ? `\n(${new Date(t.qrUnlocksAt).toLocaleString("fr-FR")})` : ""}
              </Text>
            )}
            <Text style={s.caption} numberOfLines={1}>{t.eventTitle}</Text>
          </View>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  section: { fontSize: 16, fontWeight: "800", color: colors.muted, marginTop: 10, marginBottom: 10 },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: 20, borderWidth: 1, borderColor: colors.border, alignItems: "center", marginBottom: 14 },
  caption: { marginTop: 12, fontSize: 12, color: colors.muted },
  note: { color: colors.muted, textAlign: "center", paddingVertical: 30 },
});
