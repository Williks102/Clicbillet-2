import { useState } from "react";
import { Check, Copy, Hash } from "lucide-react";

// Code public du compte (ex: "CB-7K4P2M"), affiché dans chaque espace pour que le support
// puisse identifier une personne sans lui faire épeler son e-mail ou son identifiant interne.
//
// Ce code n'est PAS un secret et n'ouvre aucun droit : il est là pour être lu à voix haute ou
// collé dans un message. Aucune action de l'application ne doit être accessible sur sa seule
// présentation (cf. server/lib/publicCode.ts).
interface AccountCodeBadgeProps {
  code?: string | null;
  className?: string;
}

export default function AccountCodeBadge({ code, className = "" }: AccountCodeBadgeProps) {
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé (navigateur ancien, contexte non sécurisé) : le code reste
      // sélectionnable à la main grâce à select-all ci-dessous, rien à signaler à l'utilisateur.
    }
  }

  return (
    <div className={`inline-flex items-center gap-2 rounded-xl border border-orange-100 bg-white px-3 py-2 ${className}`} id="account-public-code">
      <Hash className="h-3.5 w-3.5 shrink-0 text-orange-600" />
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-wider text-gray-400">Code client</p>
        <p className="select-all font-mono text-sm font-bold tracking-wider text-gray-900">{code}</p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copier mon code client"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-600 sm:h-8 sm:w-8"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
