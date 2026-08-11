import React, { useState, useEffect, useRef } from "react";
import { Camera, CheckCircle, XCircle, AlertTriangle, RefreshCw, Smartphone, Key, Ticket as TicketIcon, WifiOff, Wifi, Download, CloudUpload } from "lucide-react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { User } from "../types";
import { authFetch } from "../lib/apiClient";
import { isVipTier, formatTierLabel } from "../lib/ticketTier";
import {
  telechargerManifeste, lireManifeste, validerHorsLigne, synchroniser,
  passagesEnAttente, ageEnMinutes, type Manifeste
} from "../lib/scanOffline";

interface QrScannerTabProps {
  user: User;
}

function formatEventDay(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function QrScannerTab({ user }: QrScannerTabProps) {
  const organizerId = user.id;
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [errorResult, setErrorResult] = useState<string | null>(null);
  // Un billet refusé parce qu'il est présenté hors de sa fenêtre de validité (trop tôt, ou
  // événement terminé) n'est pas un faux billet : le contrôleur doit pouvoir faire la
  // différence à l'entrée, d'où ce marqueur renvoyé par /api/verify-ticket.
  const [refusedTicket, setRefusedTicket] = useState<any | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const isScanningRef = useRef<boolean>(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // "checking" tant que l'autorisation n'est pas tranchée : le scanner n'est instancié qu'une
  // fois la caméra confirmée disponible, pour que la sonde ci-dessous et html5-qrcode ne se
  // disputent jamais le périphérique (une caméra déjà ouverte fait échouer l'autre).
  const [cameraState, setCameraState] = useState<"checking" | "ready" | "error">("checking");

  // --- Contrôle hors ligne (cf. src/lib/scanOffline.ts) ---
  const [evenements, setEvenements] = useState<{ id: string; title: string }[]>([]);
  const [evenementPrepare, setEvenementPrepare] = useState("");
  const [manifeste, setManifeste] = useState<Manifeste | null>(null);
  const [chargement, setChargement] = useState(false);
  const [enAttente, setEnAttente] = useState(0);
  const [horsLigne, setHorsLigne] = useState(false);
  const [messageSync, setMessageSync] = useState<string | null>(null);
  // Le dernier verdict est-il issu du mode dégradé ? Le contrôleur doit le savoir : un
  // « validé » hors ligne n'a pas la même garantie qu'un « validé » confirmé par le serveur.
  const [verdictLocal, setVerdictLocal] = useState(false);

  useEffect(() => {
    authFetch("/api/scan/events")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setEvenements(d))
      .catch(() => {});
    passagesEnAttente().then((p) => setEnAttente(p.length));
  }, []);

  // Recharge le manifeste déjà présent quand on choisit un événement.
  useEffect(() => {
    if (!evenementPrepare) { setManifeste(null); return; }
    lireManifeste(evenementPrepare).then(setManifeste);
  }, [evenementPrepare]);

  async function preparerControle() {
    if (!evenementPrepare) return;
    setChargement(true);
    setMessageSync(null);
    try {
      const m = await telechargerManifeste(evenementPrepare);
      setManifeste(m);
      setMessageSync(`${m.tickets.length} billet(s) chargés sur cet appareil.`);
      setHorsLigne(false);
    } catch (e: any) {
      setMessageSync(e.message || "Téléchargement impossible.");
    } finally {
      setChargement(false);
    }
  }

  async function lancerSync() {
    try {
      const r = await synchroniser();
      setEnAttente((await passagesEnAttente()).length);
      if (!r) { setMessageSync("Aucun passage en attente."); return; }
      setHorsLigne(false);
      setMessageSync(
        r.conflicts.length > 0
          ? `${r.applied} passage(s) enregistrés — ⚠️ ${r.conflicts.length} billet(s) déjà scannés ailleurs.`
          : `${r.applied} passage(s) enregistrés.`
      );
    } catch (e: any) {
      setMessageSync(e.message || "Synchronisation impossible.");
    }
  }

  // Tentative de remontée dès que le navigateur se déclare de nouveau en ligne. On ne s'y fie
  // pas pour BASCULER en mode dégradé — navigator.onLine annonce souvent une connexion qui ne
  // porte aucun trafic — mais comme signal d'essai, il fait l'affaire.
  useEffect(() => {
    function auRetour() { passagesEnAttente().then((p) => { if (p.length > 0) lancerSync(); }); }
    window.addEventListener("online", auRetour);
    return () => window.removeEventListener("online", auRetour);
  }, []);

  function failCamera(message: string) {
    setCameraError(message);
    setCameraState("error");
  }

  // Diagnostic caméra, posé avant même d'instancier le scanner : sans lui, un refus d'accès
  // laissait simplement un viseur noir, sans un mot d'explication ni indication que la saisie
  // manuelle prend le relais — le contrôleur à l'entrée d'un événement restait bloqué là.
  useEffect(() => {
    if (!window.isSecureContext) {
      failCamera("La caméra n'est accessible qu'en HTTPS. Ouvrez ClicBillet via une adresse sécurisée, ou utilisez la saisie manuelle ci-dessous.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      failCamera("Ce navigateur ne donne pas accès à la caméra. Essayez Chrome ou Safari à jour, ou utilisez la saisie manuelle ci-dessous.");
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        // Le flux n'est demandé que pour connaître l'état de l'autorisation : on le referme
        // aussitôt, sinon la caméra reste occupée et html5-qrcode ne peut plus l'ouvrir.
        stream.getTracks().forEach((track) => track.stop());
        if (!cancelled) setCameraState("ready");
      })
      .catch((err: any) => {
        if (cancelled) return;
        const name = err?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          // Un refus au niveau du navigateur et un blocage par en-tête Permissions-Policy
          // remontent la même erreur : le message couvre donc les deux cas.
          failCamera("L'accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur (icône à gauche de la barre d'adresse), puis rechargez la page. La saisie manuelle ci-dessous reste disponible.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          failCamera("Aucune caméra détectée sur cet appareil. Utilisez la saisie manuelle ci-dessous.");
        } else if (name === "NotReadableError") {
          failCamera("La caméra est déjà utilisée par une autre application. Fermez-la puis rechargez la page.");
        } else {
          failCamera("La caméra n'a pas pu être démarrée. Utilisez la saisie manuelle ci-dessous.");
        }
      });

    return () => { cancelled = true; };
  }, []);

  // Initialize camera scanner on mounting
  useEffect(() => {
    if (cameraState !== "ready") return;
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
            if (scannerRef.current) {
              try { scannerRef.current.pause(true); } catch(e) {}
            }
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
  }, [cameraState]);

  // Post verification token code to backend API
  async function handleVerifyTicket(token: string) {
    if (verifying) return;
    setVerifying(true);
    setScanResult(null);
    setErrorResult(null);
    setRefusedTicket(null);

    try {
      const response = await authFetch("/api/verify-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrCodeData: token,
          organizerId
        })
      });

      const data = await response.json();
      if (!response.ok) {
        if (data.reason === "scan-window") setRefusedTicket(data.ticket || null);
        throw new Error(data.error || "Une erreur est survenue lors de la vérification.");
      }

      setScanResult(data);
      setVerdictLocal(false);
      setHorsLigne(false);
    } catch (err: any) {
      // Distinction essentielle : une PANNE RÉSEAU fait basculer en validation locale, alors
      // qu'un refus explicite du serveur (billet inconnu, déjà scanné) doit être montré tel
      // quel. Confondre les deux ferait accepter localement un billet que le serveur venait
      // de refuser.
      const panneReseau = err instanceof TypeError || /network|failed to fetch|load failed/i.test(err?.message || "");
      if (panneReseau && manifeste) {
        setHorsLigne(true);
        try {
          const verdict = await validerHorsLigne(manifeste.eventId, token);
          setEnAttente((await passagesEnAttente()).length);
          setVerdictLocal(true);
          if (verdict.ok) {
            setScanResult({
              success: true,
              ticket: {
                id: verdict.billet?.id,
                buyerName: verdict.billet?.buyerName,
                tier: verdict.billet?.tier,
                eventTitle: manifeste.eventTitle,
              },
            });
          } else {
            setErrorResult(verdict.message);
          }
        } catch {
          setErrorResult("Validation hors ligne impossible sur cet appareil.");
        }
      } else {
        setErrorResult(err.message || "Impossible de décoder ce ticket.");
      }
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
      
      {/* Préparation du contrôle : télécharger la liste des billets AVANT l'ouverture des
          portes, pour que le contrôle survive à la saturation du réseau à l'entrée. */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-black text-gray-900">Préparation du contrôle</h3>
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
            horsLigne ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
          }`}>
            {horsLigne ? <><WifiOff className="h-3 w-3" /> Hors ligne</> : <><Wifi className="h-3 w-3" /> Connecté</>}
          </span>
        </div>

        <p className="text-[11px] leading-relaxed text-gray-500">
          Chargez la liste des billets avant d'ouvrir les portes. Si le réseau vient à manquer,
          le contrôle continue sur cet appareil et les passages remontent au retour de la connexion.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <select
            value={evenementPrepare}
            onChange={(e) => setEvenementPrepare(e.target.value)}
            className="flex-1 min-w-[180px] rounded-xl border border-gray-200 bg-white py-2.5 px-3 text-xs outline-none focus:border-green-500"
          >
            <option value="">Choisir l'événement…</option>
            {evenements.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <button
            type="button"
            onClick={preparerControle}
            disabled={!evenementPrepare || chargement}
            className="flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2.5 text-xs font-black text-white transition-colors hover:bg-green-700 disabled:opacity-40"
          >
            <Download className={`h-3.5 w-3.5 ${chargement ? "animate-pulse" : ""}`} />
            {chargement ? "Chargement…" : "Charger les billets"}
          </button>
        </div>

        {manifeste && (
          <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-[11px] text-gray-600">
            <strong className="text-gray-900">{manifeste.tickets.length} billet(s)</strong> chargés
            {" · "}
            {/* L'âge est affiché en permanence : un agent qui voit « il y a 3 h » sait qu'un
                refus « billet introuvable » peut venir d'un achat récent, pas d'une fraude. */}
            <span className={ageEnMinutes(manifeste) > 30 ? "font-black text-amber-700" : ""}>
              il y a {ageEnMinutes(manifeste)} min
            </span>
            {ageEnMinutes(manifeste) > 30 && " — rechargez pour inclure les ventes récentes"}
          </div>
        )}

        {enAttente > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
            <span className="text-[11px] font-bold text-amber-900">
              {enAttente} passage(s) enregistrés hors ligne, en attente d'envoi
            </span>
            <button
              type="button"
              onClick={lancerSync}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-amber-700"
            >
              <CloudUpload className="h-3.5 w-3.5" /> Synchroniser
            </button>
          </div>
        )}

        {messageSync && <p className="text-[11px] font-bold text-gray-700">{messageSync}</p>}
      </section>

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
        <div className="rounded-3xl border border-gray-100 bg-white p-5 flex flex-col justify-between space-y-4">
          <h3 className="text-sm font-black text-gray-900 flex items-center space-x-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-ping" />
            <span>Viseur Appareil Photo</span>
          </h3>

          {/* HTML5 Qrcode mounting element */}
          {cameraError ? (
            <div
              id="scanner-camera-error"
              className="flex aspect-square flex-col items-center justify-center rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50 p-6 text-center"
            >
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <h4 className="mt-3 text-sm font-black text-amber-900">Caméra indisponible</h4>
              <p className="mt-2 text-[11px] leading-relaxed text-amber-800">{cameraError}</p>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-gray-950 p-1 flex items-center justify-center aspect-square shadow-inner">
              <div id="qr-reader-container" className="w-full h-full text-xs text-white" />
            </div>
          )}

          <p className="text-[10px] text-gray-400 text-center font-semibold uppercase">
            {cameraState === "error"
              ? "Utilisez la saisie manuelle ci-contre."
              : cameraState === "checking"
                ? "Vérification de l'accès à la caméra..."
                : "Placez le code QR au centre du viseur."}
          </p>
        </div>

        {/* Scan Status results reporting */}
        <div className="space-y-6">
          
          {/* Active scan outcomes details state panel */}
          <div className="rounded-3xl border border-gray-100 bg-white p-6 space-y-5 flex flex-col justify-center min-h-[250px]">
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
                    <p className="text-[11px] text-red-600 max-w-sm mx-auto leading-relaxed">
                      Ce ticket a déjà été validé à l'entrée de l'événement le {" "}
                      <strong>{new Date(scanResult.scannedAt).toLocaleString("fr-FR")}</strong>. Accès refusé !
                    </p>
                  </div>
                ) : (
                  /* 2. Success green verification checklist */
                  <div className="space-y-3 p-4 rounded-2xl bg-green-50 border border-green-100" id="scan-success-card">
                    <CheckCircle className="mx-auto h-12 w-12 text-green-600 animate-bounce" />
                    <h4 className="text-sm font-black text-green-800">ACCÈS AUTORISÉ (VALIDE)</h4>
                    <p className="text-xs text-green-700 font-bold leading-none">Profitez bien de l'événement !</p>
                    {/* Un « validé » hors ligne n'offre pas la même garantie qu'un « validé »
                        confirmé par le serveur : le contrôleur doit pouvoir faire la
                        différence, notamment si un doublon est constaté plus tard. */}
                    {verdictLocal && (
                      <p className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-100 px-2 py-1.5 text-[10px] font-black text-amber-900">
                        <WifiOff className="h-3 w-3" />
                        Validé hors ligne — sera confirmé à la synchronisation
                      </p>
                    )}
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
                      isVipTier(scanResult.ticket.tier) ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                    }`}>
                      {formatTierLabel(scanResult.ticket.tier)}
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
                  onClick={() => { 
                    setScanResult(null); 
                    setErrorResult(null); 
                    isScanningRef.current = true; 
                    if (scannerRef.current) {
                      try { scannerRef.current.resume(); } catch(e) {}
                    }
                  }}
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
                <h4 className="text-sm font-black text-gray-900">
                  {refusedTicket ? "Billet hors période de validité" : "Billet ou signature invalide"}
                </h4>
                <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">{errorResult}</p>
                {/* Le billet existe et il est authentique : on affiche son porteur pour que le
                    contrôleur puisse trancher sur place (mauvaise date, mauvais événement...). */}
                {refusedTicket && (
                  <div className="mx-auto max-w-xs rounded-xl bg-gray-50 px-4 py-3 text-left" id="scan-refused-ticket">
                    <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Billet présenté</p>
                    <p className="mt-1 text-xs font-bold text-gray-900">{refusedTicket.buyerName}</p>
                    <p className="text-[11px] font-semibold text-gray-500">
                      {refusedTicket.eventTitle} — {formatEventDay(refusedTicket.eventDate)} à {refusedTicket.eventTime}
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setErrorResult(null);
                    setRefusedTicket(null);
                    isScanningRef.current = true;
                    if (scannerRef.current) {
                      try { scannerRef.current.resume(); } catch(e) {}
                    }
                  }}
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
          <div className="rounded-3xl border border-gray-100 bg-white p-5 space-y-4">
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
