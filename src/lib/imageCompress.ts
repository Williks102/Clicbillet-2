// Redimensionne et recompresse une image côté navigateur avant de la stocker (en base64,
// directement dans la colonne "banner"). Sans ça, une simple photo de téléphone (3-4 Mo)
// gonfle chaque événement de plusieurs Mo, et cette bannière est renvoyée telle quelle dans
// la réponse JSON de /api/events à CHAQUE visiteur de la page d'accueil — c'est la cause la
// plus probable d'un chargement des événements perçu comme lent.
export function compressImageToDataUrl(file: File, maxWidth = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image invalide."));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Compression d'image non supportée par ce navigateur."));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
