import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { post } from "../../lib/api";
import { colors } from "../../lib/theme";
import { Button } from "../../lib/ui";

type Result = { ok: boolean; title: string; detail?: string };

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<Result | null>(null);
  const locked = useRef(false);

  if (!permission) return <View />;
  if (!permission.granted) {
    return (
      <View style={{ padding: 24, gap: 12 }}>
        <Text style={{ color: colors.text }}>L'accès à la caméra est nécessaire pour scanner les billets.</Text>
        <Button title="Autoriser la caméra" onPress={requestPermission} />
      </View>
    );
  }

  async function onScan(data: string) {
    if (locked.current) return;
    locked.current = true;
    try {
      const r = await post("/api/verify-ticket", { qrCodeData: data });
      const t = r.ticket;
      setResult(r.alreadyScanned
        ? { ok: false, title: "Déjà scanné", detail: t?.buyerName }
        : { ok: true, title: "Billet valide ✓", detail: t ? `${t.buyerName ?? ""} · ${String(t.tier ?? "").toUpperCase()}` : undefined });
    } catch (e: any) {
      setResult({ ok: false, title: "Refusé", detail: e.message });
    }
  }

  function reset() {
    setResult(null);
    locked.current = false;
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={result ? undefined : ({ data }) => onScan(data)}
      />
      {result && (
        <View style={[s.sheet, { backgroundColor: result.ok ? colors.success : colors.danger }]}>
          <Text style={s.title}>{result.title}</Text>
          {result.detail ? <Text style={s.detail}>{result.detail}</Text> : null}
          <View style={{ marginTop: 14 }}><Button title="Scanner le suivant" variant="ghost" onPress={reset} /></View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 24, paddingBottom: 36 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  detail: { color: "#fff", marginTop: 6, fontSize: 16 },
});
