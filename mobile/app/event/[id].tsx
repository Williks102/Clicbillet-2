import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, post, SITE_URL, API_URL } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, formatPrice } from "../../lib/format";
import { colors, radius } from "../../lib/theme";
import { Button, ErrorText } from "../../lib/ui";
import type { EventItem, TicketType } from "../../lib/types";

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [tier, setTier] = useState<TicketType | null>(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<EventItem[]>("/api/events")
      .then((all) => {
        const e = all.find((x) => x.id === id) ?? null;
        setEvent(e);
        const t = e?.ticketTypes?.[0] ?? (e ? { name: "standard", price: e.price } : null);
        setTier(t);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const tiers: TicketType[] = useMemo(
    () => event?.ticketTypes?.length ? event.ticketTypes : event ? [{ name: "standard", price: event.price }] : [],
    [event],
  );

  if (!event) return <View style={{ padding: 20 }}>{error ? <ErrorText message={error} /> : <Text style={{ color: colors.muted }}>Chargement…</Text>}</View>;

  const total = (tier?.price ?? 0) * qty;
  const free = total === 0;
  const banner = event.banner ? (event.banner.startsWith("http") || event.banner.startsWith("data:") ? event.banner : `${API_URL}${event.banner}`) : undefined;

  async function buy() {
    if (!user) return router.push("/login");
    if (!tier || !event) return;
    if (!free) {
      // Le paiement Paystack passe par un popup web : on confie la finalisation au site.
      return Linking.openURL(`${SITE_URL}/e/${event.id}`);
    }
    setBusy(true);
    setError(null);
    try {
      await post("/api/checkout", {
        eventId: event.id,
        buyerId: user.id,
        buyerName: user.name,
        buyerEmail: user.email,
        items: [{ tier: tier.name.toLowerCase(), quantity: qty }],
        paymentDetails: { method: "orange_money" },
      });
      Alert.alert("Inscription confirmée", "Votre billet est disponible dans « Mes billets ».", [
        { text: "Voir mes billets", onPress: () => router.replace("/(tabs)/tickets") },
      ]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      {banner && <Image source={{ uri: banner }} style={{ width: "100%", height: 200 }} />}
      <View style={{ padding: 16 }}>
        <Text style={s.title}>{event.title}</Text>
        <Text style={s.meta}>{formatDate(event.date, event.time)}</Text>
        <Text style={s.meta}>{event.venue} · par {event.organizerName}</Text>
        <Text style={s.desc}>{event.description}</Text>

        <Text style={s.section}>Billets</Text>
        {tiers.map((t) => (
          <Pressable key={t.name} onPress={() => setTier(t)} style={[s.tier, tier?.name === t.name && s.tierOn]}>
            <Text style={{ fontWeight: "700", color: colors.text, textTransform: "capitalize" }}>{t.name}</Text>
            <Text style={{ fontWeight: "800", color: colors.text }}>{formatPrice(t.price)}</Text>
          </Pressable>
        ))}

        <View style={s.qtyRow}>
          <Text style={{ fontWeight: "600", color: colors.text }}>Quantité</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Pressable onPress={() => setQty(Math.max(1, qty - 1))} style={s.qtyBtn}><Text style={s.qtyTxt}>−</Text></Pressable>
            <Text style={{ fontSize: 18, fontWeight: "700" }}>{qty}</Text>
            <Pressable onPress={() => setQty(Math.min(10, qty + 1))} style={s.qtyBtn}><Text style={s.qtyTxt}>+</Text></Pressable>
          </View>
        </View>

        <ErrorText message={error} />
        <Button
          title={!user ? "Se connecter pour acheter" : free ? "Réserver gratuitement" : `Payer ${formatPrice(total)} sur le site`}
          onPress={buy}
          loading={busy}
        />
        {!free && user && <Text style={s.note}>Le paiement mobile money / carte s'effectue de façon sécurisée sur clicbillet.com ; votre billet apparaîtra ensuite ici.</Text>}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  meta: { color: colors.muted, marginTop: 4 },
  desc: { marginTop: 14, color: colors.text, lineHeight: 21 },
  section: { fontSize: 16, fontWeight: "800", marginTop: 22, marginBottom: 10, color: colors.text },
  tier: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderRadius: radius, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 8 },
  tierOn: { borderColor: colors.primary, backgroundColor: "#fff7ed" },
  qtyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 16 },
  qtyBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  qtyTxt: { fontSize: 20, color: colors.primary },
  note: { marginTop: 10, fontSize: 12, color: colors.muted, textAlign: "center" },
});
