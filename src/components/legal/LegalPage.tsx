import { ReactNode } from "react";
import { ArrowLeft, Scale } from "lucide-react";

export function LegalPage({
  icon: Icon = Scale,
  title,
  subtitle,
  lastUpdated,
  onBack,
  children,
}: {
  icon?: typeof Scale;
  title: string;
  subtitle: string;
  lastUpdated: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={onBack}
        className="mb-4 flex min-h-11 items-center space-x-1.5 text-xs sm:mb-6 sm:min-h-0 font-bold text-gray-500 transition-colors hover:text-orange-600"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Retour à l'accueil</span>
      </button>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-xs sm:p-10">
        <div className="mb-8 border-b border-gray-100 pb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-600 text-white shadow-md shadow-orange-200">
            <Icon className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900">{title}</h1>
          <p className="mt-1.5 text-sm font-semibold text-gray-500">{subtitle}</p>
          <div className="mx-auto mt-4 inline-flex items-center rounded-lg bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700">
            Dernière mise à jour : {lastUpdated}
          </div>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700">{children}</div>
      </div>
    </div>
  );
}

export function LegalSection({ number, title, children }: { number?: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center border-b border-gray-50 pb-2 text-base font-bold text-gray-900">
        {number != null && <span className="mr-2 text-orange-600">{number}.</span>}
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function LegalHighlight({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm text-gray-700">{children}</div>
  );
}

export function LegalDefinitionBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-r-xl border-l-4 border-orange-600 bg-gray-50 p-4">{children}</div>
  );
}

export function LegalContactCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-orange-600 to-orange-700 p-6 text-center text-white shadow-md shadow-orange-100">
      {children}
    </div>
  );
}
