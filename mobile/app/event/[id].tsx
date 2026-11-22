import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, API_URL } from "../../lib/api";
import { isEventPast } from "../../lib/dates";
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

  const past = isEventPast(event);

  // Tout l'achat (payant comme gratuit) se fait sur la page de l'événement du site, affichée
  // dans l'app : une seule logique, le paiement Paystack reste celui du site.
  function buy() {
    router.push({ pathname: "/web", params: { path: `/e/${event!.id}`, title: event!.title } });
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
        {past ? (
          <Text style={s.note}>Cet événement est terminé.</Text>
        ) : (
          <Button title={free ? "Réserver" : `Acheter · ${formatPrice(total)}`} onPress={buy} />
        )}
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
