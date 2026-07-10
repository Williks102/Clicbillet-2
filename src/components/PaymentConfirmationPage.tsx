import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, XCircle, Ticket, Vote, ArrowRight, Mail } from "lucide-react";
import { User } from "../types";

interface PaymentConfirmationPageProps {
  orderId: string;
  user: User | null;
  onGoToTickets: () => void;
  onGoHome: () => void;
}

interface OrderStatus {
  type: "ticket" | "vote";
  status: "pending" | "paid" | "failed";
  eventTitle?: string;
  ticketsCount?: number;
  campaignTitle?: string | null;
  candidateName?: string | null;
  votesQty?: number;
}

const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 15; // ~30s

export default function PaymentConfirmationPage({ orderId, user, onGoToTickets, onGoHome }: PaymentConfirmationPageProps) {
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [notFoundAfterTimeout, setNotFoundAfterTimeout] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`);
        if (res.ok) {
          const data: OrderStatus = await res.json();
          if (cancelled) return;
          setOrder(data);
          if (data.status === "pending" && attempts.current < MAX_ATTEMPTS) {
            attempts.current += 1;
            timer = setTimeout(poll, POLL_INTERVAL_MS);
          }
          return;
        }
      } catch {
        // réseau indisponible ponctuellement : on retente comme pour un 404
      }
      if (cancelled) return;
      attempts.current += 1;
      if (attempts.current < MAX_ATTEMPTS) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } else {
        setNotFoundAfterTimeout(true);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId]);

  const isWaiting = !order || order.status === "pending";

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center" id="payment-confirmation-page">
      {isWaiting && !notFoundAfterTimeout && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-50">
            <Clock className="h-8 w-8 animate-pulse text-orange-600" />
          </div>
          <h1 className="mt-5 text-lg font-black text-gray-950">Confirmation de votre paiement...</h1>
          <p className="mt-2 text-xs text-gray-500">
            Un instant, nous attendons la confirmation de la passerelle de paiement. Cela prend généralement quelques secondes.
          </p>
          <div className="mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-orange-500" />
          </div>
        </>
      )}

      {notFoundAfterTimeout && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <Mail className="h-8 w-8 text-amber-600" />
          </div>
          <h1 className="mt-5 text-lg font-black text-gray-950">Ça prend plus de temps que prévu</h1>
          <p className="mt-2 text-xs text-gray-500">
            Votre paiement est peut-être encore en cours de traitement. Vous recevrez un email de confirmation dès qu'il sera validé — vérifiez votre boîte mail (et vos spams) dans quelques minutes.
          </p>
          <button
            onClick={onGoHome}
            className="mt-6 flex items-center gap-1.5 rounded-2xl bg-orange-600 px-6 py-3 text-xs font-black uppercase text-white active:scale-95 transition"
          >
            Retour à l'accueil <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {order?.status === "paid" && order.type === "ticket" && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-600" />
          </div>
          <h1 className="mt-5 text-lg font-black text-gray-950">Paiement confirmé !</h1>
          <p className="mt-2 text-xs text-gray-500">
            {order.ticketsCount === 1 ? "Votre billet" : `Vos ${order.ticketsCount} billets`} pour <strong className="text-gray-800">{order.eventTitle}</strong> {order.ticketsCount === 1 ? "a" : "ont"} été envoyé{order.ticketsCount === 1 ? "" : "s"} par email avec le QR code d'entrée.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {user?.role === "client" && (
              <button
                onClick={onGoToTickets}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-orange-600 px-6 py-3 text-xs font-black uppercase text-white active:scale-95 transition"
              >
                <Ticket className="h-3.5 w-3.5" /> Voir mes billets
              </button>
            )}
            <button
              onClick={onGoHome}
              className="flex items-center justify-center gap-1.5 rounded-2xl border border-gray-200 px-6 py-3 text-xs font-black uppercase text-gray-700 active:scale-95 transition"
            >
              Retour à l'accueil
            </button>
          </div>
        </>
      )}

      {order?.status === "paid" && order.type === "vote" && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-600" />
          </div>
          <h1 className="mt-5 text-lg font-black text-gray-950">Vos voix sont créditées !</h1>
          <p className="mt-2 text-xs text-gray-500">
            {order.votesQty} voix pour <strong className="text-gray-800">{order.candidateName}</strong> dans la campagne <strong className="text-gray-800">{order.campaignTitle}</strong>. Une confirmation vous a été envoyée par email.
          </p>
          <button
            onClick={onGoHome}
            className="mt-6 flex items-center gap-1.5 rounded-2xl bg-orange-600 px-6 py-3 text-xs font-black uppercase text-white active:scale-95 transition"
          >
            <Vote className="h-3.5 w-3.5" /> Retour aux campagnes
          </button>
        </>
      )}

      {order?.status === "failed" && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
            <XCircle className="h-9 w-9 text-red-600" />
          </div>
          <h1 className="mt-5 text-lg font-black text-gray-950">Le paiement n'a pas abouti</h1>
          <p className="mt-2 text-xs text-gray-500">
            Aucun montant n'a été débité définitivement. Vous pouvez retenter votre achat depuis la plateforme.
          </p>
          <button
            onClick={onGoHome}
            className="mt-6 flex items-center gap-1.5 rounded-2xl bg-orange-600 px-6 py-3 text-xs font-black uppercase text-white active:scale-95 transition"
          >
            Retour à l'accueil <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
