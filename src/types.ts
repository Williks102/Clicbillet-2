export type UserRole = 'client' | 'organizer' | 'admin';

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
  ticketTypes?: { name: string; price: number }[]; // Custom ticket types (e.g. VIP, Standard)
  venue: string; // Event location, e.g., "Palais de la Culture, Treichville"
  category: string; // "Concert", "Sport", etc.
  banner: string; // Banner image URL
  ticketsSold: number;
  totalTickets: number;
  organizerId: string;
  organizerName: string;
  status?: "pending" | "approved" | "rejected";
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
  tier: 'standard' | 'vip';
  pricePaid: number; // in XOF
  qrCodeData: string; // Contains JSON state or verification hash
  scanned: boolean;
  scannedAt: string | null;
  transactionRef: string;
  purchaseDate: string;
  quantity: number;
  paymentStatus?: 'pending' | 'paid' | 'failed';
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
  ticketsSold: number;
  activeEvents: number;
  recentSales: {
    eventTitle: string;
    buyerName: string;
    amount: number;
    date: string;
    tier: string;
  }[];
}
