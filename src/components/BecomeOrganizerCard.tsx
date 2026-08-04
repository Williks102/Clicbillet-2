import { useState, useEffect } from "react";
import { Store, Clock, CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { OrganizerRequest } from "../types";
import { authFetch } from "../lib/apiClient";

// Parcours "acheteur -> organisateur" côté espace client.
//
// La bascule n'est jamais immédiate : le formulaire crée une demande que l'administrateur
// approuve ou refuse (cf. server/routes/organizerRequests.ts). Un compte organisateur encaisse
// de l'argent, d'où la validation humaine. Le compte lui-même n'est pas recréé — même
// identifiant, même e-mail, mêmes billets déjà achetés.
export default function BecomeOrganizerCard() {
  const [request, setRequest] = useState<OrganizerRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [phone, setPhone] = useState("");
  const [motivation, setMotivation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/account/organizer-request", { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          setRequest(data.request || null);
        }
      } catch {
        // Statut indisponible : la carte reste utilisable pour déposer une demande.
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authFetch("/api/account/organizer-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName, phone, motivation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Impossible d'envoyer votre demande.");
      setRequest(data);
      setFormOpen(false);
      setOrganizationName("");
      setPhone("");
      setMotivation("");
    } catch (err: any) {
      setError(err.message || "Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  // Tant que le statut n'est pas connu, on n'affiche rien : proposer "Devenir organisateur" à
  // quelqu'un dont la demande est déjà en cours d'examen serait trompeur.
  if (!loaded) return null;

  if (request?.status === "pending") {
    return (
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4" id="organizer-request-pending">
        <div className="flex items-center gap-2.5 text-sm font-bold text-amber-800">
          <Clock className="h-4.5 w-4.5 shrink-0" />
          Demande organisateur en cours d'examen
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-amber-700">
          Votre demande pour <strong>{request.organizationName}</strong> a été transmise le{" "}
          {new Date(request.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
          L'équipe ClicBillet vous recontacte au {request.phone} et vous informera par e-mail de sa décision.
        </p>
      </div>
    );
  }

  if (request?.status === "approved") {
    return (
      <div className="rounded-2xl border border-green-100 bg-green-50 p-4" id="organizer-request-approved">
        <div className="flex items-center gap-2.5 text-sm font-bold text-green-800">
          <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
          Accès organisateur accordé
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-green-700">
          Reconnectez-vous pour accéder à votre tableau de bord organisateur.
        </p>
      </div>
    );
  }

  if (!formOpen) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-xs" id="become-organizer-card">
        {request?.status === "rejected" && (
          <div className="border-b border-gray-50 p-4">
            <div className="flex items-center gap-2.5 text-sm font-bold text-gray-700">
              <XCircle className="h-4.5 w-4.5 shrink-0 text-red-500" />
              Demande précédente non retenue
            </div>
            {request.reviewNote && (
              <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-gray-500">{request.reviewNote}</p>
            )}
          </div>
        )}
        <button
          onClick={() => setFormOpen(true)}
          className="flex w-full items-center justify-between px-4 py-3.5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50"
        >
          <span className="flex items-center gap-2.5">
            <Store className="h-4.5 w-4.5 text-orange-600" />
            {request?.status === "rejected" ? "Soumettre une nouvelle demande" : "Devenir organisateur"}
          </span>
          <ChevronRight className="h-4 w-4 text-gray-300" />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-xs" id="become-organizer-form">
      <div className="flex items-center gap-2.5 text-sm font-bold text-gray-800">
        <Store className="h-4.5 w-4.5 text-orange-600" />
        Devenir organisateur
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
        Votre compte et vos billets déjà achetés sont conservés. L'équipe ClicBillet vérifie chaque demande avant
        d'activer la vente de billets.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-600" id="organizer-request-error">{error}</p>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="organizer-request-name" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
            Nom de votre structure
          </label>
          <input
            id="organizer-request-name"
            type="text"
            required
            maxLength={120}
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            placeholder="Ex : Overcom Production"
            className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
          />
        </div>

        <div>
          <label htmlFor="organizer-request-phone" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
            Téléphone
          </label>
          <input
            id="organizer-request-phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ex : +225 07 00 00 00 00"
            className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
          />
        </div>

        <div>
          <label htmlFor="organizer-request-motivation" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
            Vos événements <span className="font-bold normal-case tracking-normal text-gray-400">(facultatif)</span>
          </label>
          <textarea
            id="organizer-request-motivation"
            rows={3}
            maxLength={1000}
            value={motivation}
            onChange={(e) => setMotivation(e.target.value)}
            placeholder="Type d'événements que vous organisez, fréquence, lieux habituels..."
            className="mt-1 w-full resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-xl bg-orange-600 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-orange-700 disabled:bg-gray-300"
        >
          {submitting ? "Envoi..." : "Envoyer ma demande"}
        </button>
        <button
          type="button"
          onClick={() => { setFormOpen(false); setError(null); }}
          className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
