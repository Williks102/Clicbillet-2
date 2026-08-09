-- ==========================================================================
-- ClicBillet — mise à jour de charge et de concurrence
-- ==========================================================================
-- À COLLER EN ENTIER dans l'éditeur SQL de Supabase, puis "Run" SANS RIEN
-- SÉLECTIONNER. Exécuter une sélection partielle coupe une ligne de commentaire
-- en deux et provoque une erreur de syntaxe sur le texte du commentaire lui-même
-- (« syntax error at or near ... »).
--
-- Ce fichier est un extrait de supabase_setup.sql : les trois blocs ci-dessous y
-- figurent à l'identique. Il est rejouable — le relancer ne casse rien et
-- n'écrase aucun compteur de vente en cours.
--
-- Contenu :
--   1. Salle d'attente : capacité réellement respectée sous affluence
--   2. Limitation de débit à compteur partagé (section 24)
--   3. Réservation de places atomique (section 25)
-- ==========================================================================


-- ==========================================
-- 1. SALLE D'ATTENTE — CAPACITÉ RESPECTÉE
-- ==========================================
-- Fait progresser la file d'attente d'un événement : expire les sessions "active" dont le
-- créneau est dépassé, puis promeut les entrées "waiting" les plus anciennes pour remplir les
-- places libérées. Appelée à chaque join/poll de statut côté server.ts (pas de cron
-- nécessaire).
--
-- Le verrou consultatif est ce qui rend la capacité réellement respectée. FOR UPDATE SKIP
-- LOCKED, seul, empêche de promouvoir DEUX FOIS LA MÊME personne — mais pas d'en promouvoir
-- trop : 300 appels simultanés lisaient chacun "0 session active", en déduisaient chacun
-- "25 places libres", et se servaient chacun dans 25 lignes différentes. Une campagne de
-- charge sur ce schéma l'a mesuré : 300 visiteurs admis d'un coup pour une capacité de 25 —
-- c'est-à-dire toute la file lâchée sur la billetterie, précisément ce que la salle d'attente
-- existe pour éviter. Or le navigateur interroge ce statut en boucle : la simultanéité n'est
-- pas un cas limite ici, c'est le régime normal.
--
-- Le verrou porte sur l'ÉVÉNEMENT, pas sur la table : deux événements progressent en
-- parallèle. Il est consultatif (et non un FOR UPDATE sur la ligne "events") pour ne pas
-- entrer en concurrence avec la réservation de places : la file d'attente ne doit jamais
-- faire patienter une vente.
CREATE OR REPLACE FUNCTION public.advance_waiting_room(p_event_id TEXT, p_capacity INT, p_active_minutes INT)
RETURNS void AS $$
BEGIN
  -- Cas courant : la file est vide et aucun créneau n'a expiré. Le poll du navigateur passe
  -- alors sans prendre le verrou — inutile de sérialiser des appels qui n'écrivent rien.
  IF NOT EXISTS (
        SELECT 1 FROM public.waiting_room_entries
         WHERE event_id = p_event_id AND status = 'active' AND active_until < now())
     AND NOT EXISTS (
        SELECT 1 FROM public.waiting_room_entries
         WHERE event_id = p_event_id AND status = 'waiting')
  THEN
    RETURN;
  END IF;

  -- Sérialise les progressions de CET événement. Libéré à la fin de la fonction (sa
  -- transaction), soit une fraction de milliseconde plus tard.
  PERFORM pg_advisory_xact_lock(hashtext('waiting_room'), hashtext(p_event_id));

  UPDATE public.waiting_room_entries
  SET status = 'expired'
  WHERE event_id = p_event_id AND status = 'active' AND active_until < now();

  WITH free_slots AS (
    SELECT GREATEST(p_capacity - COUNT(*), 0)::int AS n
    FROM public.waiting_room_entries
    WHERE event_id = p_event_id AND status = 'active'
  ),
  to_promote AS (
    SELECT id FROM public.waiting_room_entries
    WHERE event_id = p_event_id AND status = 'waiting'
    ORDER BY joined_at ASC
    LIMIT (SELECT n FROM free_slots)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.waiting_room_entries
  SET status = 'active', active_until = now() + (p_active_minutes || ' minutes')::interval
  WHERE id IN (SELECT id FROM to_promote);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==========================================
-- 24. LIMITATION DE DÉBIT À COMPTEUR PARTAGÉ
-- ==========================================
-- Les limiteurs express-rate-limit comptent en MÉMOIRE DU PROCESSUS. En serverless, chaque
-- instance a la sienne : sous un pic, Vercel en lance des dizaines et une limite de 10
-- tentatives de connexion par IP en devient 10 par instance. La protection s'évapore donc
-- exactement au moment où elle sert — une attaque par force brute n'a qu'à ouvrir assez de
-- connexions pour que chacune tombe sur une instance neuve.
--
-- Le compteur vit donc en base, partagé par toutes les instances. Fenêtre fixe plutôt que
-- glissante : c'est la sémantique qu'appliquait déjà express-rate-limit, et elle tient en une
-- seule instruction atomique — donc sans verrou ni transaction explicite, quel que soit le
-- nombre de requêtes simultanées.
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
    bucket_key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Purge des fenêtres périmées (cf. /api/cron/expire-pending-tickets) : sans elle, la table
-- garderait une ligne par IP et par route indéfiniment.
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON public.rate_limit_hits (window_start);

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- Aucune policy anon/authenticated : le comptage passe exclusivement par le backend.

-- Incrémente et tranche en UN SEUL aller-retour. L'INSERT ... ON CONFLICT est atomique : deux
-- requêtes simultanées sur la même clé ne peuvent pas lire la même valeur puis l'écraser,
-- contrairement à un SELECT suivi d'un UPDATE. C'est ce qui permet de se passer de verrou.
--
-- La fenêtre repart de zéro dès qu'elle est expirée, dans la même instruction : pas besoin
-- d'une tâche de nettoyage pour que le comptage soit juste (la purge ne sert qu'à borner la
-- taille de la table).
CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_key TEXT,
  p_max INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (allowed BOOLEAN, hits INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  v_hits INTEGER;
  v_start TIMESTAMPTZ;
BEGIN
  INSERT INTO public.rate_limit_hits AS r (bucket_key, hits, window_start)
  VALUES (p_key, 1, now())
  ON CONFLICT (bucket_key) DO UPDATE
    SET hits = CASE
                 WHEN r.window_start + (p_window_seconds || ' seconds')::interval <= now() THEN 1
                 ELSE r.hits + 1
               END,
        window_start = CASE
                 WHEN r.window_start + (p_window_seconds || ' seconds')::interval <= now() THEN now()
                 ELSE r.window_start
               END
  RETURNING r.hits, r.window_start INTO v_hits, v_start;

  RETURN QUERY SELECT
    v_hits <= p_max,
    v_hits,
    v_start + (p_window_seconds || ' seconds')::interval;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_check(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_limit_check(TEXT, INTEGER, INTEGER) TO service_role;

-- ==========================================
-- 25. RÉSERVATION DE PLACES RÉELLEMENT ATOMIQUE
-- ==========================================
-- La réservation se faisait en deux temps depuis l'application : lire "tickets_sold", puis
-- écrire "tickets_sold = <valeur lue> + quantité". Le garde-fou était bien posé dans le WHERE,
-- mais la VALEUR ÉCRITE restait celle d'une lecture périmée — donc chaque acheteur simultané
-- écrasait le compte des autres.
--
-- Une campagne de charge sur ce schéma l'a mesuré : 200 acheteurs simultanés sur 100 places
-- ont obtenu 200 billets, et le compteur affichait 1. Le garde-fou ne se déclenchait jamais,
-- puisque le compteur qu'il inspecte était remis à ~1 par les écritures concurrentes.
--
-- Le compte-et-décide vit donc désormais entièrement en base, dans une seule transaction :
--
--   FOR UPDATE pose un verrou sur la LIGNE de l'événement. Les acheteurs d'un même événement
--   sont sérialisés le temps de la réservation (moins d'une milliseconde) ; ceux d'événements
--   différents ne s'attendent pas. C'est exactement la granularité voulue : la concurrence
--   qu'on veut discipliner est celle qui porte sur le même stock.
--
--   Les compteurs bougent de façon RELATIVE (tickets_sold + p_qty), jamais par réécriture
--   d'une valeur lue au préalable : aucune écriture ne peut plus en effacer une autre.

-- Places retenues PAR PALIER. Le contrôle par palier comptait jusqu'ici les lignes de la table
-- "tickets" — or celles-ci sont écrites APRÈS la réservation, donc après la fin de la
-- transaction qui décide : les acheteurs suivants comptaient un stock qui n'existait pas
-- encore. La campagne de charge l'a montré, le plafond VIP restait dépassé même une fois la
-- capacité globale corrigée. Le palier suit donc désormais le même principe que le compteur
-- global : une valeur portée par l'événement, avancée dans la transaction qui accorde la place.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS tier_sold JSONB;

-- Initialisation pour les événements créés avant cette colonne, à partir des billets
-- existants. Restreinte aux lignes non encore initialisées : rejouer ce script ne doit pas
-- écraser les compteurs des ventes en cours.
UPDATE public.events e SET tier_sold = COALESCE((
  SELECT jsonb_object_agg(x.tier, x.n) FROM (
    SELECT lower(tier) AS tier, count(*)::int AS n FROM public.tickets
     WHERE event_id = e.id
       AND transaction_ref NOT LIKE 'FAILED-%'
       AND transaction_ref NOT LIKE 'EXPIRED-%'
     GROUP BY lower(tier)) x
), '{}'::jsonb)
WHERE tier_sold IS NULL;

-- p_items : [{"tier":"vip","quantity":2}, ...] — le détail de la commande, tel que reçu par
-- POST /api/checkout. Retourne le motif de refus plutôt qu'un simple booléen, pour que
-- l'acheteur sache si c'est l'événement ou seulement sa catégorie qui est complet.
CREATE OR REPLACE FUNCTION public.reserve_tickets(
  p_event_id TEXT,
  p_qty INTEGER,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (ok BOOLEAN, reason TEXT, tier_label TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_sold INTEGER;
  v_total INTEGER;
  v_types JSONB;
  v_tier_sold JSONB;
  v_item JSONB;
  v_tier TEXT;
  v_item_qty INTEGER;
  v_def JSONB;
  v_tier_total INTEGER;
  v_deja INTEGER;
BEGIN
  -- Verrou sur la ligne de l'événement : tout ce qui suit voit un stock stable.
  SELECT tickets_sold, total_tickets, COALESCE(ticket_types, '[]'::jsonb), COALESCE(tier_sold, '{}'::jsonb)
    INTO v_sold, v_total, v_types, v_tier_sold
  FROM public.events WHERE id = p_event_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'introuvable'::TEXT, NULL::TEXT; RETURN;
  END IF;

  IF COALESCE(v_sold, 0) + p_qty > COALESCE(v_total, 0) THEN
    RETURN QUERY SELECT false, 'capacite'::TEXT, NULL::TEXT; RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_tier := lower(v_item->>'tier');
    v_item_qty := COALESCE((v_item->>'quantity')::int, 0);
    CONTINUE WHEN v_tier IS NULL OR v_item_qty <= 0;

    SELECT t INTO v_def FROM jsonb_array_elements(v_types) AS t
     WHERE lower(t->>'name') = v_tier LIMIT 1;

    v_deja := COALESCE((v_tier_sold->>v_tier)::int, 0);

    -- Un palier sans plafond déclaré (ou absent de la grille tarifaire) ne borne que la
    -- capacité globale, déjà vérifiée plus haut : on se contente d'y tenir le compte.
    IF v_def IS NOT NULL THEN
      v_tier_total := COALESCE((v_def->>'total')::int, 0);
      IF v_tier_total > 0 AND v_deja + v_item_qty > v_tier_total THEN
        RETURN QUERY SELECT false, 'palier'::TEXT, (v_def->>'name')::TEXT; RETURN;
      END IF;
    END IF;

    v_tier_sold := jsonb_set(v_tier_sold, ARRAY[v_tier], to_jsonb(v_deja + v_item_qty), true);
  END LOOP;

  UPDATE public.events
     SET tickets_sold = COALESCE(tickets_sold, 0) + p_qty,
         tier_sold = v_tier_sold
   WHERE id = p_event_id;

  RETURN QUERY SELECT true, NULL::TEXT, NULL::TEXT;
END;
$$;

-- Rend des places au stock. Décréments RELATIFS, pour la même raison que ci-dessus : les
-- annulations (paiement échoué, panier expiré par le cron) réécrivaient une valeur lue avant
-- coup, effaçant au passage les ventes conclues entre-temps.
CREATE OR REPLACE FUNCTION public.release_tickets(
  p_event_id TEXT,
  p_qty INTEGER,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tier_sold JSONB;
  v_item JSONB;
  v_tier TEXT;
  v_reste INTEGER;
BEGIN
  SELECT COALESCE(tier_sold, '{}'::jsonb) INTO v_tier_sold
  FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_tier := lower(v_item->>'tier');
    CONTINUE WHEN v_tier IS NULL;
    v_tier_sold := jsonb_set(v_tier_sold, ARRAY[v_tier], to_jsonb(GREATEST(
      COALESCE((v_tier_sold->>v_tier)::int, 0) - COALESCE((v_item->>'quantity')::int, 0), 0)), true);
  END LOOP;

  UPDATE public.events
     SET tickets_sold = GREATEST(COALESCE(tickets_sold, 0) - p_qty, 0),
         tier_sold = v_tier_sold
   WHERE id = p_event_id
   RETURNING tickets_sold INTO v_reste;

  RETURN COALESCE(v_reste, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_tickets(TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_tickets(TEXT, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_tickets(TEXT, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_tickets(TEXT, INTEGER, JSONB) TO service_role;
