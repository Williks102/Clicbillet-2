import { useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { markOnboardingSeen } from "../lib/onboarding";
import { colors } from "../lib/theme";

const PAGES: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; text: string }[] = [
  { icon: "calendar", title: "Trouvez vos événements", text: "Concerts, festivals, matchs : tout ce qui se passe en Côte d'Ivoire, au même endroit." },
  { icon: "card", title: "Payez simplement", text: "Orange Money, MTN, Moov, Wave ou carte. Le paiement est sécurisé et reste celui de ClicBillet." },
  { icon: "qr-code", title: "Entrez avec votre QR code", text: "Votre billet est un simple QR code à présenter à l'entrée. Rien d'autre à imprimer." },
];

export default function Onboarding() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList>(null);
  const last = index === PAGES.length - 1;

  async function finish() {
    await markOnboardingSeen();
    router.replace("/(tabs)");
  }

  function next() {
    if (last) return finish();
    list.current?.scrollToIndex({ index: index + 1, animated: true });
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.top}>
        {!last && <Pressable onPress={finish} hitSlop={12}><Text style={s.skip}>Passer</Text></Pressable>}
      </View>

      <FlatList
        ref={list}
        data={PAGES}
        keyExtractor={(p) => p.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={[s.page, { width }]}>
            <View style={s.circle}><Ionicons name={item.icon} size={84} color="#fff" /></View>
            <Text style={s.title}>{item.title}</Text>
            <Text style={s.text}>{item.text}</Text>
          </View>
        )}
      />

      <View style={s.bottom}>
        <View style={s.dots}>
          {PAGES.map((p, i) => <View key={p.title} style={[s.dot, i === index && s.dotOn]} />)}
        </View>
        <Pressable onPress={next} style={s.btn}>
          <Text style={s.btnText}>{last ? "Commencer" : "Suivant"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  top: { height: 44, alignItems: "flex-end", justifyContent: "center", paddingHorizontal: 24 },
  skip: { color: "#fff", fontSize: 16, fontWeight: "600" },
  page: { alignItems: "center", justifyContent: "center", paddingHorizontal: 36 },
  circle: { width: 168, height: 168, borderRadius: 84, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", marginBottom: 40 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", textAlign: "center" },
  text: { color: "#ffedd5", fontSize: 17, lineHeight: 25, textAlign: "center", marginTop: 14 },
  bottom: { paddingHorizontal: 24, paddingBottom: 24, gap: 22 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.4)" },
  dotOn: { width: 24, backgroundColor: "#fff" },
  btn: { backgroundColor: "#fff", borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnText: { color: colors.primaryDark, fontSize: 17, fontWeight: "800" },
});
