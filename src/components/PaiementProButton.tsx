import React, { useState, useEffect } from "react";
import { CreditCard, Smartphone, Check, Loader2, AlertCircle } from "lucide-react";
import { motion } from "motion/react";

/**
 * Options de configuration requises par le SDK PaiementPro (Côte d'Ivoire)
 */
export interface PaiementProConfig {
  merchantId: string;
  amount: number;
  channel: "OMCIV2" | "MOMOCI" | "FLOOZ" | "WAVECI" | "CARD" | string;
  referenceNumber: string;
  customerEmail: string;
  customerFirstName: string;
  customerLastname: string;
  customerPhoneNumber: string;
  description: string;
  notificationURL: string;
  returnURL: string;
  returnContext?: string;
}

interface PaiementProButtonProps {
  /** Configuration de transaction */
  config: PaiementProConfig;
  /** Libellé personnalisé pour le bouton */
  label?: string;
  /** Classement CSS supplémentaire si nécessaire */
  className?: string;
  /** Callback déclenché avant l'appel API Paiement Pro */
  onBeforePay?: () => Promise<boolean> | boolean;
  /** Callback déclenché avec l'URL de paiement obtenue */
  onPaymentUrlGenerated?: (url: string) => void;
  /** Callback en cas d'erreur de chargement ou d'initialisation */
  onError?: (errorMsg: string) => void;
}

/**
 * Composant React officiel de paiement sécurisé avec le widget Paiement Pro (CI)
 * Gère le chargement transparent du SDK officiel, affiche des états de chargement
 * fluides et ouvre sans friction le guichet de paiement.
 */
export const PaiementProButton: React.FC<PaiementProButtonProps> = ({
  config,
  label = "Procéder au paiement",
  className = "",
  onBeforePay,
  onPaymentUrlGenerated,
  onError
}) => {
  const [sdkStatus, setSdkStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [isProcessing, setIsProcessing] = useState(false);
  const [internalError, setInternalError] = useState<string | null>(null);

  // Vérifier périodiquement si PaiementPro de index.html est chargé globalement
  useEffect(() => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const LibPaiementPro = (window as any).PaiementPro;
      if (LibPaiementPro) {
        if ((window as any).PaiementPro.isFallback) {
          setSdkStatus("fallback");
        } else {
          setSdkStatus("ready");
        }
        clearInterval(interval);
      } else if (attempts > 12) {
        // Au bout de 6 secondes sans SDK, on passe en mode simulé mais fonctionnel
        setSdkStatus("fallback");
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const handlePayClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    setInternalError(null);
    setIsProcessing(true);

    try {
      // 1. Exécuter d'éventuelles validations côté utilisateur
      if (onBeforePay) {
        const proceed = await onBeforePay();
        if (!proceed) {
          setIsProcessing(false);
          return;
        }
      }

      // 2. Récupérer le SDK PaiementPro attaché à la fenêtre globale
      const LibPaiementPro = (window as any).PaiementPro;
      if (!LibPaiementPro) {
        throw new Error("Le SDK PaiementPro n'a pas pu être chargé. Veuillez vérifier votre connexion.");
      }

      console.log(`[PaiementPro React Component] Démarrage transaction pour le marchand : ${config.merchantId}`);
      const pPro = new LibPaiementPro(config.merchantId);

      // Injecter les variables conformément aux spécifications
      pPro.amount = config.amount;
      pPro.channel = config.channel;
      pPro.referenceNumber = config.referenceNumber;
      pPro.customerEmail = config.customerEmail;
      pPro.customerLastName = config.customerLastname; // Le SDK utilise parfois customerLastName ou customerLastname
      pPro.customerLastname = config.customerLastname;
      pPro.customerFirstName = config.customerFirstName;
      pPro.customerPhoneNumber = config.customerPhoneNumber;
      pPro.description = config.description;
      pPro.notificationURL = config.notificationURL;
      pPro.returnURL = config.returnURL;

      if (config.returnContext) {
        pPro.returnContext = config.returnContext;
      }

      // 3. Appeler le service pour récupérer l'url sécurisée de paiement
      await pPro.getUrlPayment();

      if (pPro.success && pPro.url) {
        console.log("[PaiementPro React Component] Lien de facturation généré avec succès :", pPro.url);
        
        if (onPaymentUrlGenerated) {
          onPaymentUrlGenerated(pPro.url);
        }

        // Ouvrir automatiquement la page de paiement
        window.open(pPro.url, "_blank");
      } else {
        throw new Error("L'initialisation de la passerelle PaiementPro a renvoyé un statut invalide.");
      }
    } catch (err: any) {
      console.error("[PaiementPro React Component Error]", err);
      const msg = err.message || "Une erreur est survenue lors de l'initialisation du paiement.";
      setInternalError(msg);
      if (onError) {
        onError(msg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Couleur de badge pour informer l'utilisateur de l'état réseau
  const statusColors = {
    loading: "bg-gray-100 text-gray-400 border-gray-200",
    ready: "bg-emerald-50 text-emerald-700 border-emerald-100",
    fallback: "bg-orange-50 text-orange-700 border-orange-100"
  };

  const statusLabels = {
    loading: "Chargement du CDN sécurisé...",
    ready: "Guichet Paiement Pro sécurisé",
    fallback: "Guichet Paiement Pro simulé"
  };

  const isOmOrMtnOrMoov = config.channel !== "CARD" && config.channel !== "WAVECI";

  return (
    <div className={`space-y-4`} id="paiement-pro-react-container">
      {/* Visual Indicator of Secure Gateway Integrity */}
      <div className={`flex items-center justify-between p-3.5 rounded-2xl border text-[11px] font-bold ${statusColors[sdkStatus]}`}>
        <div className="flex items-center space-x-2">
          {sdkStatus === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />
          )}
          <span>{statusLabels[sdkStatus]}</span>
        </div>
        <span className="font-mono bg-white px-2 py-0.5 rounded shadow-xs font-black shrink-0 text-[10px]">
          ID : {config.merchantId}
        </span>
      </div>

      {internalError && (
        <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-100 rounded-xl text-[11px] font-semibold text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{internalError}</span>
        </div>
      )}

      {/* Main Payment Trigger Button */}
      <button
        onClick={handlePayClick}
        disabled={isProcessing}
        type="button"
        id="paiement-pro-react-btn"
        className={`w-full relative overflow-hidden transition-all duration-300 transform active:scale-[0.98] ${
          isProcessing
            ? "cursor-not-allowed opacity-90"
            : ""
        } ${className}`}
      >
        <span className="flex items-center justify-center space-x-2">
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Génération du guichet...</span>
            </>
          ) : (
            <>
              {config.channel === "CARD" && <CreditCard className="h-4 w-4" />}
              {isOmOrMtnOrMoov && <Smartphone className="h-4 w-4" />}
              <span>{label}</span>
            </>
          )}
        </span>
      </button>

      {/* Visual details under payment button */}
      <p className="text-[10px] text-center text-gray-400 font-semibold">
        Opération sécurisée cryptée de bout en bout par la plateforme <strong className="text-gray-600">Paiement Pro™</strong>.
      </p>
    </div>
  );
};
