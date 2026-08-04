import { useState } from "react";
import {
  Mail,
  Phone,
  MapPin,
  Clock,
  Send,
  Info,
  Link as LinkIcon,
  HelpCircle,
  CheckCircle2,
  ArrowLeft
} from "lucide-react";

const SUBJECTS = ["Question générale", "Problème technique", "Problème de paiement", "Demande de remboursement", "Devenir partenaire", "Autre"];

const QUICK_FAQ = [
  { q: "Comment modifier ma commande ?", a: "Les modifications sont possibles jusqu'à 24h avant l'événement." },
  { q: "Puis-je annuler ma commande ?", a: "Selon les conditions de l'organisateur, contactez-nous." },
  { q: "Je n'ai pas reçu mes billets", a: "Vérifiez vos spams ou contactez-nous avec votre numéro de commande." },
  { q: "Comment devenir organisateur ?", a: "Inscrivez-vous avec un compte organisateur sur notre plateforme." }
];

export default function ContactPage({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "ClicBillet" },
        credentials: "include",
        body: JSON.stringify({ name, email, subject, message })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Une erreur est survenue lors de l'envoi.");
      }
      setSent(true);
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
    } catch (err: any) {
      setError(err.message || "Impossible d'envoyer le message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={onBack}
        className="mb-6 flex items-center space-x-1.5 text-xs font-bold text-gray-500 transition-colors hover:text-orange-600"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Retour à l'accueil</span>
      </button>

      <div className="mb-8 text-center">
        <h1 className="text-2xl font-black text-gray-900 sm:text-3xl">Nous contacter</h1>
        <p className="mt-2 text-sm text-gray-500">Une question ? Une suggestion ? Nous sommes là pour vous écouter.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Formulaire */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-xs sm:p-8">
            <h2 className="mb-5 flex items-center gap-2 text-base font-black text-gray-900">
              <Mail className="h-4.5 w-4.5 text-orange-600" />
              <span>Envoyez-nous un message</span>
            </h2>

            {sent ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-8 text-center" id="contact-success-view">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                <p className="text-sm font-bold text-emerald-800">Message envoyé !</p>
                <p className="text-xs text-emerald-700">Notre équipe vous répondra dans les meilleurs délais.</p>
                <button
                  onClick={() => setSent(false)}
                  className="mt-2 text-xs font-bold text-emerald-700 underline"
                >
                  Envoyer un autre message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" id="contact-form">
                {error && (
                  <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-600 border border-red-100" id="contact-error-alert">
                    {error}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-700">Nom complet *</label>
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-700">Email *</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Sujet *</label>
                  <select
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                  >
                    <option value="">Choisissez un sujet</option>
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Message *</label>
                  <textarea
                    required
                    rows={6}
                    maxLength={5000}
                    placeholder="Décrivez votre demande en détail..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                  />
                </div>

                <button
                  type="submit"
                  disabled={sending}
                  className="flex items-center gap-2 rounded-xl bg-orange-600 px-6 py-3 text-sm font-black text-white transition hover:bg-orange-700 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  <span>{sending ? "Envoi..." : "Envoyer le message"}</span>
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Sidebar informations */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-xs">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-black text-gray-900">
              <Info className="h-4 w-4 text-orange-600" />
              <span>Informations de contact</span>
            </h3>
            <div className="space-y-4 text-xs">
              <div className="flex items-start gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                <div>
                  <p className="font-bold text-gray-900">contact@clicbillet.com</p>
                  <p className="text-gray-400">Réponse dans l'heure</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                <div>
                  <p className="font-bold text-gray-900">+225 07 02 49 02 77</p>
                  <p className="text-gray-400">Lun-Ven 8h-18h</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                <div>
                  <p className="font-bold text-gray-900">Abidjan, Cocody</p>
                  <p className="text-gray-400">Côte d'Ivoire</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                <div>
                  <p className="font-bold text-gray-900">Horaires support</p>
                  <p className="text-gray-400">Lun-Ven : 8h-18h · Sam : 9h-15h · Dim : Fermé</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-orange-600 to-orange-700 p-6 text-white shadow-md shadow-orange-100">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black">
              <LinkIcon className="h-4 w-4" />
              <span>Liens utiles</span>
            </h3>
            <ul className="space-y-2 text-xs">
              <li>Consultez nos <button onClick={onBack} className="underline">tarifs</button></li>
            </ul>
          </div>
        </div>
      </div>

      {/* FAQ rapide */}
      <div className="mt-10 rounded-3xl bg-gray-50 p-6 sm:p-10">
        <h2 className="text-center text-lg font-black text-gray-900">Questions fréquentes</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {QUICK_FAQ.map((item) => (
            <div key={item.q} className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-xs">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <div>
                <h4 className="text-xs font-black text-gray-900">{item.q}</h4>
                <p className="mt-1 text-[11px] text-gray-500">{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
