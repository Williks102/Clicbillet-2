// Signature « release » lue dans l'environnement (jamais de secret dans le dépôt).
// Variables : ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD.
// Sans ANDROID_KEYSTORE_PATH, le build « release » reste signé avec la clé de test d'Expo
// (APK d'essai) ; avec, il est signé avec votre clé d'upload (AAB du Play Store).
const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes("ANDROID_KEYSTORE_PATH")) return cfg;

    g = g.replace(
      /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\n\s{8}\}\n)(\s{4}\})/,
      `$1        release {
            if (System.getenv("ANDROID_KEYSTORE_PATH")) {
                storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
$2`
    );
    // Uniquement le type de build « release » (dans buildTypes), pas le bloc signingConfigs.release.
    g = g.replace(
      /(buildTypes\s*\{[\s\S]*?\n\s+release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig System.getenv("ANDROID_KEYSTORE_PATH") ? signingConfigs.release : signingConfigs.debug`
    );
    cfg.modResults.contents = g;
    return cfg;
  });
};
