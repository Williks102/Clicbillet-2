import { useState } from "react";
import { X, CheckCircle2 } from "lucide-react";
import ResponsiveSheet from "./ResponsiveSheet";

interface VendorContactModalProps {
  vendorAlias: string;
  vendorName: string;
  onClose: () => void;
}

// Formulaire public de demande de devis, jumeau des autres formulaires en bottom-sheet du
// projet (GuestOrAuthModal). Pas d'authentification requise — POST /api/vendors/:alias/contact
// (server/routes/vendors.ts) relaie un e-mail au prestataire et garde une trace consultable
// depuis son tableau de bord.
export default function VendorContactModal({ vendorAlias, vendorName, onClose }: VendorContactModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/vendors/${encodeURIComponent(vendorAlias)}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "ClicBillet" },
        body: JSON.stringify({ name, email, phone, eventDate, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Impossible d'envoyer votre demande.");
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveSheet
      id="vendor-contact-modal-overlay"
      panelId="vendor-contact-modal-panel"
      onClose={onClose}
      panelClassName="max-w-md overflow-hidden border border-gray-100 flex flex-col max-h-[92dvh] sm:max-h-[90vh]"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-gray-50 bg-gray-50/50 px-6 py-4">
        <h3 className="min-w-0 flex-1 pr-2 text-sm font-black text-gray-900">
          Demander un devis à {vendorName}
        </h3>
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-4.5 w-4.5" />
        </button>
      </div>

      <div className="overflow-y-auto p-6">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center" id="vendor-contact-sent">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="text-sm font-black text-gray-900">Demande envoyée</p>
            <p className="text-xs leading-relaxed text-gray-500">
              {vendorName} a reçu votre message et vous recontactera directement au {phone || "numéro indiqué"} ou par e-mail.
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-orange-700"
            >
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3" id="vendor-contact-form">
            {error && (
              <p className="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-600" id="vendor-contact-error">{error}</p>
            )}

            <div>
              <label htmlFor="vendor-contact-name" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Votre nom
              </label>
              <input
                id="vendor-contact-name"
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="vendor-contact-email" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                  E-mail
                </label>
                <input
                  id="vendor-contact-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                />
              </div>
              <div>
                <label htmlFor="vendor-contact-phone" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                  Téléphone <span className="font-bold normal-case tracking-normal text-gray-400">(facultatif)</span>
                </label>
                <input
                  id="vendor-contact-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                />
              </div>
            </div>

            <div>
              <label htmlFor="vendor-contact-date" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Date de l'événement <span className="font-bold normal-case tracking-normal text-gray-400">(facultatif)</span>
              </label>
              <input
                id="vendor-contact-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
              />
            </div>

            <div>
              <label htmlFor="vendor-contact-message" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Votre message
              </label>
              <textarea
                id="vendor-contact-message"
                rows={4}
                required
                maxLength={3000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type d'événement, lieu, nombre d'invités, budget envisagé..."
                className="mt-1 w-full resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-orange-600 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-orange-700 disabled:bg-gray-300"
            >
              {submitting ? "Envoi..." : "Envoyer ma demande"}
            </button>
          </form>
        )}
      </div>
    </ResponsiveSheet>
  );
}
