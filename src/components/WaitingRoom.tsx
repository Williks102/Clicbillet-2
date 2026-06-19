import React, { useEffect, useRef, useState } from "react";
import { Clock, X, ShieldCheck } from "lucide-react";
import { Event, User, WaitingRoomStatus } from "../types";
import { authFetch, TokenRefreshHandler } from "../lib/apiClient";

interface WaitingRoomProps {
  event: Event;
  user: User;
  onTokenRefresh: TokenRefreshHandler;
  onGranted: () => void;
  onCancel: () => void;
}

const POLL_INTERVAL_MS = 4000;

export default function WaitingRoom({ event, user, onTokenRefresh, onGranted, onCancel }: WaitingRoomProps) {
  const [position, setPosition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grantedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    async function poll(path: string, options: RequestInit) {
      const response = await authFetch(path, options, user, onTokenRefresh);
      const data: WaitingRoomStatus & { error?: string } = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erreur de la salle d'attente.");
      }
      return data;
    }

    async function start() {
      try {
        const initial = await poll("/api/waiting-room/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: event.id })
        });
        if (cancelled) return;
        applyStatus(initial);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Impossible de rejoindre la salle d'attente.");
      }
    }

    function applyStatus(data: WaitingRoomStatus) {
      if (data.status === "active") {
        if (!grantedRef.current) {
          grantedRef.current = true;
          onGranted();
        }
        return;
      }
      setPosition(data.position);
      pollTimer = setTimeout(checkStatus, POLL_INTERVAL_MS);
    }

    async function checkStatus() {
      try {
        const data = await poll(`/api/waiting-room/status?eventId=${encodeURIComponent(event.id)}`, {});
        if (cancelled) return;
        applyStatus(data);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Impossible de vérifier votre position dans la file.");
          pollTimer = setTimeout(checkStatus, POLL_INTERVAL_MS);
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs" id="waiting-room-overlay">
      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden border border-gray-100 flex flex-col items-center p-8 text-center">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-50">
          <Clock className="h-8 w-8 text-orange-600 animate-pulse" />
        </div>

        <h2 className="text-lg font-bold text-gray-900">Forte affluence sur cet événement</h2>
        <p className="mt-2 text-sm text-gray-500">
          Pour garantir un accès équitable à tous, vous patientez dans la file d'attente avant
          d'accéder au paiement pour <strong>{event.title}</strong>.
        </p>

        {error ? (
          <p className="mt-6 text-sm font-semibold text-red-600">{error}</p>
        ) : position !== null ? (
          <div className="mt-6 w-full rounded-2xl bg-gray-50 border border-gray-100 py-5">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Votre position</p>
            <p className="mt-1 text-3xl font-extrabold text-orange-600">{position}</p>
          </div>
        ) : (
          <div className="mt-6 h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
        )}

        <p className="mt-4 flex items-center gap-1.5 text-xs text-gray-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Cette page se met à jour automatiquement, inutile de recharger.
        </p>
      </div>
    </div>
  );
}
