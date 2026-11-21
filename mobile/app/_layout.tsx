import { useEffect, useState } from "react";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "../lib/auth";
import { hasSeenOnboarding } from "../lib/onboarding";
import { colors } from "../lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const router = useRouter();
  const { loading } = useAuth();
  const [checked, setChecked] = useState(false);

  // Premier lancement : on affiche l'intro avant le catalogue.
  useEffect(() => {
    hasSeenOnboarding().then((seen) => {
      if (!seen) router.replace("/onboarding");
      setChecked(true);
    });
  }, [router]);

  // Le splash reste affiché tant que la session et le choix de l'intro ne sont pas connus.
  useEffect(() => {
    if (checked && !loading) SplashScreen.hideAsync().catch(() => {});
  }, [checked, loading]);

  return (
    <Stack screenOptions={{ headerTintColor: colors.primary, headerTitleStyle: { color: colors.text }, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="event/[id]" options={{ title: "Événement" }} />
      <Stack.Screen name="web" options={{ title: "ClicBillet" }} />
      <Stack.Screen name="login" options={{ title: "Connexion", presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Shell />
    </AuthProvider>
  );
}
