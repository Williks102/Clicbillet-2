import React, { useRef, useState } from "react";
import { Upload, CheckCircle2, X } from "lucide-react";
import { compressImageToDataUrl } from "../lib/imageCompress";

// Zone d'import de l'affiche d'un événement (glisser-déposer ou sélection de fichier).
//
// Extraite du formulaire de création pour que celui de MODIFICATION en dispose aussi : il ne
// proposait que les visuels prédéfinis et un champ URL, si bien qu'un organisateur ne pouvait
// pas remplacer l'affiche d'un événement déjà publié par une image de son appareil — il
// fallait supprimer l'événement et le recréer.
//
// L'identifiant du champ fichier est fourni par l'appelant : deux zones peuvent coexister
// dans la page (création et modification), et un id dupliqué ferait ouvrir le mauvais
// sélecteur de fichier.
export function BannerUploadZone({
  value,
  onChange,
  onError,
  inputId,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  onError: (message: string) => void;
  inputId: string;
}) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const importee = value.startsWith("data:image");

  function traiter(file: File) {
    if (!file.type.startsWith("image/")) {
      onError("Veuillez sélectionner un fichier image (JPG, PNG, GIF, WEBP).");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      onError("La taille de l'image ne doit pas dépasser 4 Mo.");
      return;
    }
    // Redimensionne/recompresse avant de stocker : une photo de téléphone telle quelle
    // (plusieurs Mo) alourdirait la réponse /api/events envoyée à chaque visiteur.
    compressImageToDataUrl(file)
      .then(onChange)
      .catch(() => onError("Impossible de traiter cette image, réessayez avec un autre fichier."));
  }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) traiter(file);
  }

  return (
    <div
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer flex flex-col items-center justify-center space-y-2 relative overflow-hidden ${
        dragActive
          ? "border-orange-500 bg-orange-50"
          : importee
          ? "border-emerald-500 bg-emerald-50/20"
          : "border-gray-200 hover:border-orange-400 hover:bg-gray-50 bg-white"
      }`}
    >
      <input
        type="file"
        id={inputId}
        ref={inputRef}
        className="hidden"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) traiter(file);
          // Réinitialise le champ : sans cela, réimporter le MÊME fichier après l'avoir
          // effacé ne déclenche aucun événement (la valeur n'a pas changé).
          e.target.value = "";
        }}
      />

      {importee ? (
        <div className="flex flex-col items-center space-y-2">
          <div className="relative">
            <img
              src={value}
              alt="Prévisualisation d'affiche"
              className="h-20 w-32 object-cover rounded-xl border border-emerald-200 shadow-sm"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-red-500 shadow-md transition-colors hover:border-red-600 hover:bg-red-600 hover:text-white"
              title="Effacer la photo"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="flex items-center gap-1 text-[11px] font-black text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Photo importée avec succès !</span>
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-full bg-orange-50 p-3 text-orange-600">
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-black text-gray-800">
              Glissez-déposez votre affiche ici, ou <span className="text-orange-600 underline">parcourez vos fichiers</span>
            </p>
            <p className="text-[9px] text-gray-400 mt-1 uppercase font-bold">PNG, JPG, WEBP jusqu'à 4 Mo maximum</p>
          </div>
        </>
      )}
    </div>
  );
}
