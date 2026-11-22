import { ActivityIndicator, Linking, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { SITE_URL } from "../lib/api";
import { colors } from "../lib/theme";

// Domaines autorisés dans la WebView : le site et le paiement Paystack. Tout le reste
// s'ouvre dans le navigateur du téléphone.
const ALLOWED = [new URL(SITE_URL).host, "paystack.co", "paystack.com"];

function isAllowed(url: string): boolean {
  try {
    const host = new URL(url).host;
    return ALLOWED.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export default function Web() {
  const { path, title } = useLocalSearchParams<{ path?: string; title?: string }>();
  const safePath = typeof path === "string" && path.startsWith("/") ? path : "/";

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: title || "ClicBillet" }} />
      <WebView
        source={{ uri: `${SITE_URL}${safePath}` }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        startInLoadingState
        renderLoading={() => <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />}
        onShouldStartLoadWithRequest={(req) => {
          if (isAllowed(req.url) || req.url.startsWith("about:") || req.url.startsWith("data:")) return true;
          Linking.openURL(req.url);
          return false;
        }}
      />
    </View>
  );
}
