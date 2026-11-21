import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { colors } from "../../lib/theme";

export default function TabsLayout() {
  const { user } = useAuth();
  const canScan = user?.role === "organizer" || user?.role === "admin";
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleStyle: { color: colors.text } }}>
      <Tabs.Screen name="index" options={{ title: "Événements", tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color as string} size={size} /> }} />
      <Tabs.Screen name="tickets" options={{ title: "Mes billets", tabBarIcon: ({ color, size }) => <Ionicons name="ticket" color={color as string} size={size} /> }} />
      <Tabs.Screen name="scan" options={{ title: "Scanner", href: canScan ? undefined : null, tabBarIcon: ({ color, size }) => <Ionicons name="qr-code" color={color as string} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color as string} size={size} /> }} />
    </Tabs>
  );
}
