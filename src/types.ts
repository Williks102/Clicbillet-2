export type UserRole = 'client' | 'organizer' | 'admin';

// Le jeton de session vit dans un cookie httpOnly côté serveur (cf. server/lib/auth.ts),
// jamais dans cet objet : aucun champ token/refreshToken ici, contrairement à avant.
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  price: number; // Base price in XOF
  ticketTypes?: { name: string; price: number; total?: number }[]; // Custom ticket types (e.g. VIP, Standard)
  ticketsSoldByTier?: Record<string, number>; // Sold count per tier name (computed server-side)
  venue: string; // Event location, e.g., "Palais de la Culture, Treichville"
  category: string; // "Concert", "Sport", etc.
  banner: string; // Banner image URL
  ticketsSold: number;
  totalTickets: number;
  organizerId: string;
  organizerName: string;
  organizerAlias?: string | null; // Alias public (page /o/:alias) — absent si l'organisateur n'en a pas défini
  status?: "pending" | "approved" | "rejected";
  waitingRoomEnabled?: boolean;
  waitingRoomCapacity?: number;
  commissionRate?: number | null; // Taux négocié pour cet événement (null = taux plateforme par défaut)
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
