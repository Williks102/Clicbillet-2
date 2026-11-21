export type UserRole = "client" | "organizer" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  publicCode?: string | null;
}

export interface TicketType {
  name: string;
  price: number;
  total?: number;
}

export interface EventItem {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  venue: string;
  category: string;
  price: number;
  banner: string;
  ticketTypes?: TicketType[];
  ticketsSoldByTier?: Record<string, number>;
  ticketsSold: number;
  totalTickets: number;
  organizerName: string;
}

export interface Ticket {
  id: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventVenue: string;
  tier: string;
  quantity: number;
  pricePaid: number;
  qrCodeData: string | null;
  qrUnlocksAt?: string | null;
  scanned: boolean;
  paymentStatus?: "pending" | "paid" | "failed";
}
