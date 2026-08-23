export type UserRole = 'client' | 'organizer' | 'admin';

// Le jeton de session vit dans un cookie httpOnly côté serveur (cf. server/lib/auth.ts),
// jamais dans cet objet : aucun champ token/refreshToken ici, contrairement à avant.
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  // Référence courte et dictable du compte (ex: "CB-7K4P2M"), affichée dans l'espace de
  // l'utilisateur pour faciliter sa prise en charge par le support. Purement identifiante :
  // elle n'ouvre aucun droit et n'authentifie rien (cf. server/lib/publicCode.ts).
  publicCode?: string | null;
}

// Demande de passage acheteur -> organisateur (cf. server/routes/organizerRequests.ts).
// Seule l'approbation par un administrateur fait basculer le rôle du compte.
export interface OrganizerRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPublicCode?: string | null;
  organizationName: string;
  phone: string;
  motivation: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// Demande de fiche prestataire (marché de prestataires, cf. server/routes/vendorRequests.ts),
// jumeau de OrganizerRequest. Contrairement au passage organisateur, l'approbation ne change
// pas le rôle du compte : elle crée une fiche (VendorProfile) rattachée au même compte.
export interface VendorRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPublicCode?: string | null;
  businessName: string;
  phone: string;
  city: string;
  description: string | null;
  categorySlugs: string[];
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  // Fin de l'événement (facultative). Elle borne la fenêtre de scan des billets et détermine
  // à partir de quand l'événement est considéré comme passé. Absente = durée par défaut.
  endDate?: string | null;
  endTime?: string | null;
  price: number; // Base price in XOF
  // Types de billets définis par l'organisateur (ex: VIP, Standard). salesStart/salesEnd
  // bornent facultativement la vente de CE tarif ("YYYY-MM-DDTHH:MM"), indépendamment de la
  // date de l'événement : c'est ce qui permet un early bird ou un pass de dernière minute.
  ticketTypes?: { name: string; price: number; total?: number; salesStart?: string | null; salesEnd?: string | null }[];
  ticketsSoldByTier?: Record<string, number>; // Sold count per tier name (computed server-side)
  venue: string; // Event location, e.g., "Palais de la Culture, Treichville"
  category: string;
  categorySlug?: string | null; // "Concert", "Sport", etc.
  banner: string; // Banner image URL
  ticketsSold: number;
  totalTickets: number;
  organizerId: string;
  organizerName: string;
  organizerAlias?: string | null; // Alias public (page /o/:alias) — absent si l'organisateur n'en a pas défini
  status?: "pending" | "approved" | "rejected";
  scheduledOnsale?: boolean;
  commissionRate?: number | null; // Taux négocié pour cet événement (null = taux plateforme par défaut)
  // Habillage du pass remis à l'acheteur. Absent du catalogue public (logo et image de fond
  // sont des data: URI) : l'organisateur le lit via GET /api/events/:id/pass-design.
  passDesign?: PassDesign | null;
}

// Couleurs, logo et image de fond du pass, choisis par l'organisateur. Les valeurs sont
// validées côté serveur (couleurs #RRGGBB uniquement) avant d'être stockées : elles finissent
// dans des attributs `style`, y compris dans le document d'impression construit par
// concaténation de chaînes.
export interface PassDesign {
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  logoUrl: string | null;
  backgroundImageUrl: string | null;
  backgroundOpacity: number;
}

export interface WaitingRoomStatus {
  status: "waiting" | "active" | "expired";
  position: number;
  estimatedActiveAt?: string | null;
}

export interface PayoutRequest {
  id: string;
  organizerId: string;
  organizerName?: string;
  amount: number;
  status: "pending" | "completed" | "rejected";
  requestDate: string;
  method: string;
  details: string;
}

export interface TransactionLog {
  id: string;
  eventId: string;
  buyerEmail?: string;
  amount: number;
  status: "success" | "failed" | "pending";
  date: string;
  method: string;
  errorDetails?: string;
}

export interface Ticket {
  id: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventVenue: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  tier: string; // Nom du type de billet en minuscules (ex: "standard", "vip", ou tout nom personnalisé défini par l'organisateur)
  pricePaid: number; // in XOF
  qrCodeData: string | null; // null si verrouillé (cf. qrUnlocksAt) : anti-fraude, visible seulement à l'approche de l'événement
  qrUnlocksAt?: string | null; // ISO ; présent seulement quand qrCodeData est verrouillé
  scanned: boolean;
  scannedAt: string | null;
  transactionRef: string;
  purchaseDate: string;
  quantity: number;
  paymentStatus?: 'pending' | 'paid' | 'failed';
  // Habillage hérité de l'événement (cf. GET /api/my-tickets) : porté par l'événement et non
  // figé à l'achat, pour qu'une retouche des couleurs s'applique aussi aux billets déjà vendus.
  passDesign?: PassDesign | null;
}

// Historique en lecture seule d'un transfert de billet (cf. GET /api/my-transfers) : une ligne
// immuable par transfert, indépendante de qui possède actuellement le billet aujourd'hui.
export interface TicketTransfer {
  id: string;
  ticketId: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventVenue: string;
  tier: string;
  pricePaid: number;
  fromName: string;
  fromEmail: string;
  toName: string;
  toEmail: string;
  transferredAt: string;
}

export type PaymentMethod = 'orange_money' | 'mtn_momo' | 'moov_money' | 'wave' | 'card';

export interface PaymentDetails {
  method: PaymentMethod;
  phoneNumber?: string; // For mobile money
  otp?: string; // For Orange Money
  cardName?: string;
  cardNumber?: string;
  expiry?: string;
  cvv?: string;
}

export interface SalesStatus {
  totalRevenue: number;
  totalGrossRevenue: number;
  totalCommission: number;
  commissionRate: number;
  ticketsSold: number;
  activeEvents: number;
  recentSales: {
    eventTitle: string;
    buyerName: string;
    amount: number;
    date: string;
    tier: string;
  }[];
  tickets: {
    id: string;
    eventId: string;
    eventTitle: string;
    buyerName: string;
    buyerEmail: string;
    tier: string;
    pricePaid: number;
    scanned: boolean;
    scannedAt: string | null;
    transactionRef: string;
    purchaseDate: string;
    quantity: number;
  }[];
}
