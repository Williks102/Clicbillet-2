import React, { useRef } from "react";
import { Upload, X, RotateCcw, Sparkles } from "lucide-react";
import { PassDesign } from "../types";
import { compressImageToDataUrl } from "../lib/imageCompress";
import { PASS_DESIGN_PAR_DEFAUT, buildPassTheme, estPassDesignParDefaut } from "../lib/passDesign";

// Éditeur de l'habillage du pass, partagé par les formulaires de CRÉATION et de MODIFICATION
// d'un événement — comme la zone d'import de l'affiche, dont la duplication avait fini par
// laisser les deux formulaires diverger.
//
// L'aperçu n'est pas décoratif : il reprend la structure exacte du pass remis à l'acheteur
// (cf. ClientDashboard), seul moyen pour l'organisateur de constater qu'un fond trop foncé
// rend le texte illisible avant de publier son événement.

const MAX_TAILLE_FICHIER = 4 * 1024 * 1024;

interface PassDesignEditorProps {
  value: PassDesign;
  onChange: (design: PassDesign) => void;
  onError: (message: string) => void;
  // Préfixe des id de champs : deux éditeurs coexistent dans la page (création et
  // modification), et un id dupliqué ferait ouvrir le mauvais sélecteur de fichier.
  idPrefix: string;
}

export default function PassDesignEditor({ value, onChange, onError, idPrefix }: PassDesignEditorProps) {
  const theme = buildPassTheme(value);
  const parDefaut = estPassDesignParDefaut(value);

  function set<K extends keyof PassDesign>(champ: K, valeur: PassDesign[K]) {
    onChange({ ...value, [champ]: valeur });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
            <Sparkles className="h-3.5 w-3.5 text-orange-600" />
            Habillage du pass
          </span>
          <p className="mt-1 text-[10px] font-semibold leading-relaxed text-gray-400">
            Couleurs, logo et image de fond du billet remis à vos acheteurs. Les modifications
            s'appliquent aussi aux billets déjà vendus.
          </p>
        </div>
        {!parDefaut && (
          <button
            type="button"
            onClick={() => onChange({ ...PASS_DESIGN_PAR_DEFAUT })}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          >
            <RotateCcw className="h-3 w-3" />
            Réinitialiser
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ChampCouleur label="Accent" value={value.primaryColor} onChange={(v) => set("primaryColor", v)} id={`${idPrefix}-pass-primary`} />
        <ChampCouleur label="Fond" value={value.backgroundColor} onChange={(v) => set("backgroundColor", v)} id={`${idPrefix}-pass-bg`} />
        <ChampCouleur label="Texte" value={value.textColor} onChange={(v) => set("textColor", v)} id={`${idPrefix}-pass-text`} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChampImage
          label="Logo"
          aide="PNG conseillé (transparence conservée)"
          value={value.logoUrl}
          onChange={(v) => set("logoUrl", v)}
          onError={onError}
          inputId={`${idPrefix}-pass-logo`}
          maxWidth={400}
          mimeType="image/png"
        />
        <ChampImage
          label="Image de fond"
          aide="Atténuée automatiquement pour rester lisible"
          value={value.backgroundImageUrl}
          onChange={(v) => set("backgroundImageUrl", v)}
          onError={onError}
          inputId={`${idPrefix}-pass-background`}
          maxWidth={1000}
          mimeType="image/jpeg"
        />
      </div>

      {value.backgroundImageUrl && (
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Intensité de l'image de fond — {Math.round(value.backgroundOpacity * 100)} %
          </span>
          <input
            type="range"
            min={0}
            max={60}
            step={2}
            value={Math.round(value.backgroundOpacity * 100)}
            onChange={(e) => set("backgroundOpacity", Number(e.target.value) / 100)}
            className="w-full accent-orange-600"
          />
          <span className="block text-[10px] text-gray-400">
            Au-delà de 30 %, le texte du billet devient difficile à lire sur la plupart des images.
          </span>
        </label>
      )}

      {/* Aperçu */}
      <div className="space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Aperçu du pass</span>
        <div
          className="relative overflow-hidden rounded-2xl p-4"
          style={{ backgroundColor: theme.backgroundColor, border: `1px dashed ${theme.primaryColor}` }}
        >
          {theme.backgroundImageUrl && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url(${theme.backgroundImageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                opacity: theme.backgroundOpacity
              }}
            />
          )}
          <div className="relative text-center">
            {theme.logoUrl ? (
              <img src={theme.logoUrl} alt="" style={{ maxHeight: 34, maxWidth: "55%", margin: "0 auto 6px", display: "block", objectFit: "contain" }} />
            ) : (
              <span className="block text-sm font-black" style={{ color: theme.textColor }}>
                CLIC<span style={{ color: theme.primaryColor }}>BILLET</span>
              </span>
            )}
            <span
              className="mt-1 inline-block rounded-sm px-2 py-0.5 text-[9px] font-black uppercase"
              style={{ backgroundColor: theme.primaryColor, color: theme.onPrimaryColor }}
            >
              Pass VIP
            </span>
            <p className="mt-1.5 text-xs font-black leading-tight" style={{ color: theme.textColor }}>
              Votre événement
            </p>
          </div>

          <div
            className="relative mt-3 flex items-center justify-center rounded-xl py-3"
            style={{ backgroundColor: theme.surfaceColor, border: `1px solid ${theme.borderColor}` }}
          >
            <div className="grid h-16 w-16 grid-cols-4 grid-rows-4 gap-0.5 rounded bg-white p-1.5">
              {/* Damier neutre : l'aperçu ne doit pas afficher un vrai QR code, qui n'existe
                  pas encore et n'aurait aucune valeur ici. */}
              {Array.from({ length: 16 }).map((_, i) => (
                <span key={i} className={i % 3 === 0 ? "bg-gray-900" : "bg-gray-200"} />
              ))}
            </div>
          </div>

          <div className="relative mt-3 flex items-center justify-between pt-2" style={{ borderTop: `1px dashed ${theme.borderColor}` }}>
            <span className="text-[9px] font-bold" style={{ color: theme.mutedColor }}>REF DE PAIEMENT</span>
            <span className="text-[10px] font-black" style={{ color: theme.primaryColor }}>15 000 XOF</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChampCouleur({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <label className="space-y-1" htmlFor={id}>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-2 py-1.5">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <span className="font-mono text-[11px] font-bold uppercase text-gray-600">{value}</span>
      </div>
    </label>
  );
}

function ChampImage({
  label,
  aide,
  value,
  onChange,
  onError,
  inputId,
  maxWidth,
  mimeType
}: {
  label: string;
  aide: string;
  value: string | null;
  onChange: (v: string | null) => void;
  onError: (message: string) => void;
  inputId: string;
  maxWidth: number;
  mimeType: "image/jpeg" | "image/png";
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function traiter(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("Veuillez sélectionner un fichier image (JPG, PNG, GIF, WEBP).");
      return;
    }
    if (file.size > MAX_TAILLE_FICHIER) {
      onError("La taille de l'image ne doit pas dépasser 4 Mo.");
      return;
    }
    // Redimensionnée avant stockage : ces images voyagent dans la réponse JSON des billets de
    // chaque acheteur, une photo de téléphone brute y pèserait plusieurs Mo.
    compressImageToDataUrl(file, maxWidth, 0.8, mimeType)
      .then(onChange)
      .catch(() => onError("Impossible de traiter cette image, réessayez avec un autre fichier."));
  }

  return (
    <div className="space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 p-2">
        {value ? (
          <img src={value} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-300">
            <Upload className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-[11px] font-bold text-orange-600 hover:text-orange-700"
          >
            {value ? "Remplacer" : "Importer une image"}
          </button>
          <span className="block truncate text-[10px] text-gray-400">{aide}</span>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Retirer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <input
        type="file"
        id={inputId}
        ref={inputRef}
        className="hidden"
        accept="image/*"
        onChange={(e) => {
          traiter(e.target.files?.[0]);
          // Réinitialise la valeur : réimporter LE MÊME fichier après l'avoir retiré ne
          // déclencherait sinon aucun change.
          e.target.value = "";
        }}
      />
    </div>
  );
}
