import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { api, API_URL } from "../../lib/api";
import { formatDate, formatPrice } from "../../lib/format";
import { colors, radius } from "../../lib/theme";
import { Empty, ErrorText } from "../../lib/ui";
import type { EventItem } from "../../lib/types";

export function bannerUri(e: EventItem): string | undefined {
  if (!e.banner) return undefined;
  return e.banner.startsWith("http") || e.banner.startsWith("data:") ? e.banner : `${API_URL}${e.banner}`;
}

export default function Events() {
  const router = useRouter();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setEvents(await api<EventItem[]>("/api/events"));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const list = events.filter((e) => `${e.title} ${e.venue} ${e.category}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <FlatList
      data={list}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 16, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View>
          <TextInput value={q} onChangeText={setQ} placeholder="Rechercher un événement…" placeholderTextColor={colors.muted} style={s.search} />
          <ErrorText message={error} />
        </View>
      }
      ListEmptyComponent={error ? undefined : <Empty text="Aucun événement à venir pour le moment." />}
      renderItem={({ item }) => (
        <Pressable style={s.card} onPress={() => router.push(`/event/${item.id}`)}>
          {bannerUri(item) ? <Image source={{ uri: bannerUri(item) }} style={s.banner} /> : <View style={[s.banner, { backgroundColor: colors.border }]} />}
          <View style={{ padding: 14 }}>
            <Text style={s.cat}>{item.category}</Text>
            <Text style={s.title}>{item.title}</Text>
            <Text style={s.meta}>{formatDate(item.date, item.time)}</Text>
            <Text style={s.meta}>{item.venue}</Text>
            <Text style={s.price}>{item.price ? `Dès ${formatPrice(item.price)}` : "Gratuit"}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  search: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 16, marginBottom: 6, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  banner: { width: "100%", height: 150 },
  cat: { color: colors.primary, fontWeight: "700", fontSize: 12, textTransform: "uppercase" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text, marginVertical: 4 },
  meta: { color: colors.muted, fontSize: 14 },
  price: { marginTop: 8, fontWeight: "800", color: colors.text },
});
