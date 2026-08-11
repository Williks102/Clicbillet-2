import { authFetch } from "./apiClient";

// ==========================================
// CONTRÔLE D'ACCÈS HORS LIGNE
// ==========================================
// Le contrôle exigeait une connexion : chaque scan attendait la réponse du serveur. À
// l'entrée d'une salle, quand deux mille personnes arrivent en même temps avec leur
// téléphone, le réseau mobile sature — c'est le régime normal d'une soirée, pas l'incident
// rare. Le contrôle s'arrêtait alors net.
//
// Le manifeste est donc chargé avant l'ouverture des portes, la validation se fait localement
// quand le réseau manque, et les passages remontent au retour.
//
// IndexedDB plutôt que localStorage : quelques milliers de billets dépassent le quota de ce
// dernier, et ses écritures synchrones bloqueraient l'aperçu caméra à chaque scan.

const DB_NOM = "clicbillet-scan";
const DB_VERSION = 1;
const MAGASIN_MANIFESTE = "manifeste";
const MAGASIN_JOURNAL = "journal";

export interface BilletManifeste {
  id: string;
  h: string;
  tier: string;
  buyerName: string | null;
  st: "ok" | "unpaid" | "scanned";
}

export interface Manifeste {
  eventId: string;
  eventTitle: string;
  generatedAt: string;
  scanWindow: { opensAt: string; closesAt: string };
  tickets: BilletManifeste[];
}

export interface Passage {
  ticketId: string;
  at: string;
  eventId: string;
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOM, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MAGASIN_MANIFESTE)) {
        db.createObjectStore(MAGASIN_MANIFESTE, { keyPath: "eventId" });
      }
      if (!db.objectStoreNames.contains(MAGASIN_JOURNAL)) {
        // Clé auto-incrémentée : deux passages du même billet (tentative de doublon sur
        // CE téléphone) doivent tous deux laisser une trace.
        db.createObjectStore(MAGASIN_JOURNAL, { keyPath: "seq", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transaction<T>(magasin: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return ouvrir().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(magasin, mode);
    const req = action(tx.objectStore(magasin));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }));
}

// Empreinte SHA-256, identique à celle du serveur. Le manifeste ne contient jamais les codes
// en clair : un téléphone perdu ne doit pas permettre de fabriquer des billets.
export async function empreinte(texte: string): Promise<string> {
  const octets = new TextEncoder().encode(texte);
  const digest = await crypto.subtle.digest("SHA-256", octets);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Identifiant stable de cet appareil, pour attribuer les passages à une porte lors de la
// résolution des doublons.
export function idAppareil(): string {
  const cle = "clicbillet-device-id";
  let id = localStorage.getItem(cle);
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(cle, id);
  }
  return id;
}

export async function telechargerManifeste(eventId: string): Promise<Manifeste> {
  const reponse = await authFetch(`/api/scan/manifest?eventId=${encodeURIComponent(eventId)}`);
  const data = await reponse.json();
  if (!reponse.ok) throw new Error(data.error || "Téléchargement du manifeste impossible.");
  await transaction(MAGASIN_MANIFESTE, "readwrite", (s) => s.put(data));
  return data as Manifeste;
}

export async function lireManifeste(eventId: string): Promise<Manifeste | null> {
  try {
    return (await transaction<Manifeste>(MAGASIN_MANIFESTE, "readonly", (s) => s.get(eventId))) || null;
  } catch {
    return null;
  }
}

export async function passagesEnAttente(): Promise<(Passage & { seq: number })[]> {
  try {
    return (await transaction<(Passage & { seq: number })[]>(MAGASIN_JOURNAL, "readonly", (s) => s.getAll())) || [];
  } catch {
    return [];
  }
}

async function inscrirePassage(p: Passage): Promise<void> {
  await transaction(MAGASIN_JOURNAL, "readwrite", (s) => s.add(p));
}

export interface VerdictLocal {
  ok: boolean;
  motif: "valide" | "inconnu" | "deja-scanne" | "impaye" | "hors-fenetre" | "pas-de-manifeste";
  billet?: BilletManifeste;
  message: string;
}

// Validation locale. Applique les MÊMES refus que le serveur — déjà scanné, paiement non
// confirmé, hors fenêtre — pour que le mode dégradé ne soit jamais plus permissif que le mode
// connecté : un contrôleur ne pourrait pas expliquer qu'un billet passe quand le réseau tombe.
export async function validerHorsLigne(eventId: string, qrCodeData: string): Promise<VerdictLocal> {
  const manifeste = await lireManifeste(eventId);
  if (!manifeste) {
    return { ok: false, motif: "pas-de-manifeste", message: "Aucune liste de billets chargée sur cet appareil. Connectez-vous pour préparer le contrôle." };
  }

  const maintenant = Date.now();
  if (maintenant < new Date(manifeste.scanWindow.opensAt).getTime()) {
    return { ok: false, motif: "hors-fenetre", message: "Trop tôt : le contrôle n'est pas encore ouvert pour cet événement." };
  }
  if (maintenant > new Date(manifeste.scanWindow.closesAt).getTime()) {
    return { ok: false, motif: "hors-fenetre", message: "Événement terminé : ce billet n'est plus valide." };
  }

  const h = await empreinte(qrCodeData);
  const billet = manifeste.tickets.find((t) => t.h === h);
  if (!billet) {
    return { ok: false, motif: "inconnu", message: "Billet introuvable dans la liste chargée. S'il a été acheté à l'instant, reconnectez-vous pour rafraîchir." };
  }
  if (billet.st === "unpaid") {
    return { ok: false, motif: "impaye", billet, message: "Paiement non confirmé pour ce billet : entrée refusée." };
  }

  // Déjà scanné, d'après le manifeste (avant l'ouverture) ou d'après ce même appareil.
  const journal = await passagesEnAttente();
  const dejaIci = journal.some((p) => p.ticketId === billet.id);
  if (billet.st === "scanned" || dejaIci) {
    return { ok: false, motif: "deja-scanne", billet, message: "Billet déjà utilisé : entrée refusée." };
  }

  await inscrirePassage({ ticketId: billet.id, at: new Date().toISOString(), eventId });
  return { ok: true, motif: "valide", billet, message: "Entrée autorisée (hors ligne)." };
}

export interface ResultatSync {
  applied: number;
  conflicts: { ticketId: string; existingScannedAt?: string; existingDevice?: string | null }[];
}

// Remonte le journal puis le vide. Ne vide QUE ce qui a été envoyé : un passage enregistré
// pendant l'appel réseau ne doit pas disparaître sans avoir été transmis.
export async function synchroniser(): Promise<ResultatSync | null> {
  const journal = await passagesEnAttente();
  if (journal.length === 0) return null;

  const reponse = await authFetch("/api/scan/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: idAppareil(),
      passages: journal.map(({ ticketId, at }) => ({ ticketId, at }))
    })
  });
  const data = await reponse.json();
  if (!reponse.ok) throw new Error(data.error || "Synchronisation impossible.");

  const envoyes = new Set(journal.map((p) => p.seq));
  await ouvrir().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MAGASIN_JOURNAL, "readwrite");
    const magasin = tx.objectStore(MAGASIN_JOURNAL);
    envoyes.forEach((seq) => magasin.delete(seq));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));

  return data as ResultatSync;
}

// Âge du manifeste, en minutes. Affiché en permanence pendant le contrôle : un agent qui voit
// « chargé il y a 3 heures » sait qu'un refus « billet introuvable » peut venir d'un achat
// récent plutôt que d'une fraude.
export function ageEnMinutes(manifeste: Manifeste): number {
  return Math.floor((Date.now() - new Date(manifeste.generatedAt).getTime()) / 60000);
}
