import React, { useState, useEffect, useRef } from "react";
import { Camera, CheckCircle, XCircle, AlertTriangle, RefreshCw, Smartphone, Key, Ticket as TicketIcon } from "lucide-react";
import { Html5QrcodeScanner } from "html5-qrcode";

interface QrScannerTabProps {
  organizerId: string;
}

export default function QrScannerTab({ organizerId }: QrScannerTabProps) {
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [errorResult, setErrorResult] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const isScanningRef = useRef<boolean>(true);

  // Initialize camera scanner on mounting
  useEffect(() => {
    // We delay slightly to let the mounting render cycle settle
    const timer = setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner(
          "qr-reader-container",
          { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
            videoConstraints: {
              facingMode: "environment"
            },
            rememberLastUsedCamera: true
          },
          /* verbose= */ false
        );

        scanner.render(
          (decodedText) => {
            // Success scan handle
            if (!isScanningRef.current) return;
            isScanningRef.current = false; // Freeze the scan decoding
            handleVerifyTicket(decodedText);
          },
          (err) => {
            // Silent error logs since scanning is continuous frame parsing
          }
        );

        scannerRef.current = scanner;
      } catch (err) {
        console.error("Failed to initialize html5-qrcode scanner", err);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.clear().catch((err) => {
          console.warn("Could not clear html5-qrcode renderer correctly on unmount", err);
        });
      }
    };
  }, []);

  // Post verification token code to backend API
  async function handleVerifyTicket(token: string) {
    if (verifying) return;
    setVerifying(true);
    setScanResult(null);
    setErrorResult(null);

    try {
      const response = await fetch("/api/verify-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrCodeData: token,
          organizerId
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Une erreur est survenue lors de la vérification.");
      }

      setScanResult(data);
    } catch (err: any) {
      setErrorResult(err.message || "Impossible de décoder ce ticket.");
    } finally {
      setVerifying(false);
    }
  }

  // Handle manual code typed as fallback if camera permissions are blocked
  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualCode.trim()) return;

    // Standardize code to matched token format
    const code = manualCode.trim();
    const mockToken = code.startsWith("clicbillet-verify:") ? code : `clicbillet-verify:${code}`;
    handleVerifyTicket(mockToken);
  }

  return (
    <div className="space-y-6 py-6" id="qr-scanner-wrapper">
      
      {/* Dynamic welcome headers */}
      <section className="rounded-2xl border border-green-100 bg-green-50/50 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-gray-950 flex items-center space-x-1.5">
            <Camera className="h-5.5 w-5.5 text-green-600" />
            <span>Contrôle d'Accès ClicBillet</span>
          </h2>
          <p className="mt-1 text-xs text-gray-500 font-medium leading-relaxed">
            Utilisez l'appareil photo de votre smartphone pour scanner les QR codes sécurisés des clients et valider leur accès instantanément.
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-600 text-white shadow-md shadow-green-100 shrink-0">
          <Smartphone className="h-6 w-6" />
        </div>
      </section>

      {/* Main Grid: camera on left/top, scan result & manual code fallback on right/bottom */}
      <section className="grid gap-6 md:grid-cols-2" id="scanner-grid-panel">
        
        {/* Web camera viewfinder pane */}
        <div className="rounded-3xl border border-gray-150 bg-white p-5 flex flex-col justify-between space-y-4">
          <h3 className="text-sm font-black text-gray-900 flex items-center space-x-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-ping" />
            <span>Viseur Appareil Photo</span>
          </h3>

          {/* HTML5 Qrcode mounting element */}
          <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-gray-950 p-1 flex items-center justify-center aspect-square shadow-inner">
            <div id="qr-reader-container" className="w-full h-full text-xs text-white" />
          </div>

          <p className="text-[10px] text-gray-400 text-center font-semibold uppercase">
            Placez le code QR au centre du viseur.
          </p>
        </div>

        {/* Scan Status results reporting */}
        <div className="space-y-6">
          
          {/* Active scan outcomes details state panel */}
          <div className="rounded-3xl border border-gray-150 bg-white p-6 space-y-5 flex flex-col justify-center min-h-[250px]">
            <h3 className="text-sm font-black text-gray-900 pb-3 border-b border-gray-50">
              Résultat du Scan
            </h3>

            {verifying ? (
              <div className="py-12 text-center" id="scanner-verifying-loader">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-dashed border-orange-200 border-t-orange-600" />
                <p className="mt-3 text-xs text-gray-500 font-semibold">Vérification de la signature du ticket...</p>
              </div>
            ) : scanResult ? (
              /* Success or scanned notification elements */
              <div className="space-y-4 text-center">
                
                {/* 1. If scanned already */}
                {scanResult.alreadyScanned ? (
                  <div className="space-y-3 p-4 rounded-2xl bg-red-50 border border-red-100" id="scan-already-scanned">
                    <XCircle className="mx-auto h-12 w-12 text-red-500" />
                    <h4 className="text-sm font-black text-red-800">Billet DÉJÀ UTILISÉ &Egrave;XPR&Egrave;S</h4>
                    <p className="text-[11px] text-red-650 max-w-sm mx-auto leading-relaxed">
                      Ce ticket a déjà été validé à l'entrée de l'événement le {" "}
                      <strong>{new Date(scanResult.scannedAt).toLocaleString("fr-FR")}</strong>. Accès refusé !
                    </p>
                  </div>
                ) : (
                  /* 2. Success green verification checklist */
                  <div className="space-y-3 p-4 rounded-2xl bg-green-50 border border-green-150" id="scan-success-card">
                    <CheckCircle className="mx-auto h-12 w-12 text-green-600 animate-bounce" />
                    <h4 className="text-sm font-black text-green-800">ACCÈS AUTORISÉ (VALIDE)</h4>
                    <p className="text-xs text-green-700 font-bold leading-none">Profitez bien de l'événement !</p>
                  </div>
                )}

                {/* Subdetails layout tables */}
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-left text-xs space-y-2.5">
                  <div className="flex justify-between border-b border-gray-100 pb-1.5 font-sans">
                    <span className="text-gray-400 font-bold">Événement</span>
                    <span className="font-extrabold text-gray-900 truncate max-w-[200px]">{scanResult.ticket.eventTitle}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-1.5">
                    <span className="text-gray-400 font-bold">Bénéficiaire</span>
                    <span className="font-extrabold text-gray-900">{scanResult.ticket.buyerName}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-1.5 font-mono">
                    <span className="text-gray-400 font-bold">Catégorie Pass</span>
                    <span className={`px-1.5 py-0.5 rounded-sm font-bold uppercase text-[9px] ${
                      scanResult.ticket.tier === "vip" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                    }`}>
                      {scanResult.ticket.tier === "vip" ? "VIP" : "Standard"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 font-bold">Ref Transaction</span>
                    <span className="font-extrabold text-gray-900 font-mono text-[10px]">{scanResult.ticket.transactionRef}</span>
                  </div>
                </div>

                <button
                  type="button"
                  id="reset-scanner-btn"
                  onClick={() => { setScanResult(null); setErrorResult(null); isScanningRef.current = true; }}
                  className="flex items-center space-x-1.5 mx-auto rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-black text-white hover:bg-orange-700 transition active:scale-95 shadow-sm shadow-orange-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Scanner un autre billet</span>
                </button>
              </div>
            ) : errorResult ? (
              /* Custom decryption parse/error indicators */
              <div className="text-center space-y-4 py-6" id="scan-error-card">
                <AlertTriangle className="mx-auto h-12 w-12 text-amber-500 animate-pulse" />
                <h4 className="text-sm font-black text-gray-900">Billet ou signature invalide</h4>
                <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">{errorResult}</p>
                <button
                  type="button"
                  onClick={() => { setErrorResult(null); isScanningRef.current = true; }}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
                >
                  Réessayer
                </button>
              </div>
            ) : (
              /* Waiting scan indicators default screen */
              <div className="py-12 text-center text-gray-400 space-y-3" id="scanner-idle-state">
                <TicketIcon className="mx-auto h-10 w-10 text-gray-300 rotate-12" />
                <p className="text-xs font-semibold">En attente de détection de ticket...</p>
                <p className="text-[10px] max-w-xs mx-auto leading-relaxed text-gray-400">Le scan s'effectue automatiquement dès qu'un QR code ClicBillet est positionné devant la caméra.</p>
              </div>
            )}
          </div>

          {/* Backup manual code verification layout */}
          <div className="rounded-3xl border border-gray-150 bg-white p-5 space-y-4">
            <h4 className="text-xs font-black text-gray-900 flex items-center space-x-1.5">
              <Key className="h-4 w-4 text-orange-500" />
              <span>Saisie Manuelle (Option de secours)</span>
            </h4>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                id="manual-ticket-id-input"
                type="text"
                placeholder="Ex : tkt-17178726527"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="flex-1 rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 placeholder:text-gray-300"
              />
              <button
                type="submit"
                id="manual-ticket-verify-btn"
                className="rounded-xl bg-orange-600 px-4 py-3 text-xs font-black text-white hover:bg-orange-700 transition active:scale-95"
              >
                Vérifier
              </button>
            </form>
            <p className="text-[9px] text-gray-400 font-semibold leading-relaxed">Si la caméra ne fonctionne pas, saisissez l'identifiant ID présent sous le QR code du ticket client.</p>
          </div>

        </div>

      </section>

    </div>
  );
}
