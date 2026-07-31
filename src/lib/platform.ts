import { Capacitor } from "@capacitor/core";

// true uniquement lorsque l'app tourne dans le conteneur natif Capacitor (iOS/Android) —
// false dans un navigateur classique, y compris en PWA installée.
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
