import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "onboarding_seen_v1";

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    return true; // en cas d'échec de lecture, ne pas bloquer l'utilisateur sur l'intro
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, "1");
  } catch {
    // sans conséquence : l'intro sera simplement proposée à nouveau
  }
}

export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // idem
  }
}
