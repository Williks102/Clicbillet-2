import { useEffect, useRef, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "../lib/auth";
import { hasSeenOnboarding } from "../lib/onboarding";
import { colors } from "../lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const router = useRouter();
  const segments = useSegments();
  const { user, loading } = useAuth();
  const [seen, setSeen] = useState<boolean | null>(null);
  const started = useRef(false);

  useEffect(() => {
    hasSeenOnboarding().then(setSeen);
  }, []);

  const ready = seen !== null && !loading;
  const first = segments[0] as string | undefined;

  useEffect(() => {
    if (!ready) return;

    // Premier affichage : intro si jamais vue, sinon écran de connexion si pas de session.
    if (!started.current) {
      started.current = true;
      if (!seen) router.replace("/onboarding");
      else if (!user) router.replace("/auth");
      SplashScreen.hideAsync().catch(() => {});
      return;
    }

    // Ensuite : le compte est obligatoire (déconnexion, session expirée…). L'intro reste
    // accessible sans compte, c'est elle qui mène à l'écran de connexion.
    if (!user && first !== "auth" && first !== "onboarding") router.replace("/auth");
  }, [ready, seen, user, first, router]);

  return (
    <Stack screenOptions={{ headerTintColor: colors.primary, headerTitleStyle: { color: colors.text }, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="event/[id]" options={{ title: "Événement" }} />
      <Stack.Screen name="web" options={{ title: "ClicBillet" }} />
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
