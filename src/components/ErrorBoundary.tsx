import React, { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Pas de remontée réseau ici : il n'y a pas de route /api/errors côté serveur.
    // La console reste la source de diagnostic pour l'instant.
    console.error("[ErrorBoundary] Crash React intercepté :", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
          <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500 border border-red-100">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-base font-black text-gray-900">Une erreur est survenue.</h2>
            <p className="mt-2 text-xs text-gray-500">
              Veuillez rafraîchir la page. Si le problème persiste, contactez le support.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex items-center justify-center space-x-1.5 rounded-xl bg-orange-600 px-6 py-3 text-xs font-black text-white hover:bg-orange-700 transition active:scale-95"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Rafraîchir la page</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
