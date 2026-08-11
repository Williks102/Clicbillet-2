-- ==========================================================================
-- ClicBillet — charge, concurrence, catégories et contrôle hors ligne
-- ==========================================================================
-- À COLLER EN ENTIER dans l'éditeur SQL de Supabase, puis "Run" SANS RIEN
-- SÉLECTIONNER. Exécuter une sélection partielle coupe une ligne de commentaire
-- en deux et provoque une erreur de syntaxe sur le texte du commentaire lui-même
-- (« syntax error at or near ... »).
--
-- Extrait de supabase_setup.sql, à l'identique. Rejouable : le relancer ne casse
-- rien, n'écrase aucun compteur de vente en cours et ne touche pas aux
-- catégories déjà réglées depuis l'onglet Configuration.
--
-- Contenu :
--   1. Salle d'attente : capacité réellement respectée sous affluence
--   2. Limitation de débit à compteur partagé (section 24)
--   3. Réservation de places atomique (section 25)
--   4. Salle d'attente armée par la mesure (section 26)
--   5. Référentiel des catégories (section 27)
--   6. Contrôle d'accès hors ligne (section 28)
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

-- ==========================================
-- 26. SALLE D'ATTENTE ARMÉE PAR LA MESURE
-- ==========================================
-- La salle d'attente s'activait par une case cochée à la création de l'événement, avec une
-- "capacité simultanée en checkout" saisie par l'organisateur. Deux problèmes :
--
--   C'était un PARI, pris au pire moment. À la création — souvent des semaines avant — nul ne
--   sait si la demande explosera. Oubliée alors que la ruée arrive, la file ne protège rien :
--   c'est précisément la panne qu'elle existe pour éviter, et il est trop tard pour réagir.
--   Cochée sans ruée, des visiteurs patientent devant une salle vide — sur un événement qui
--   vend trente billets, un écran d'attente ressemble à un site en panne et coûte des ventes.
--   Ce second cas étant de loin le plus fréquent, la case était surtout un inconvénient.
--
--   La CAPACITÉ n'est pas une question sur l'événement. C'est une question sur ce que le
--   backend et la passerelle de paiement encaissent en parallèle : l'organisateur n'a aucun
--   moyen de la connaître. Un réglage dont personne ne peut deviner la bonne valeur est pire
--   qu'aucun réglage — il est renseigné au hasard, avec assurance.
--
-- Depuis la réservation atomique (section 25), la file n'est plus un mécanisme de JUSTESSE :
-- l'intégrité du stock est garantie par la base quelle que soit la charge. Il ne lui reste
-- que le lissage. Elle peut donc être rare et automatique plutôt qu'imposée à l'avance.

-- Réglages désormais tenus par la plateforme, pas par l'organisateur.
--   waiting_room_threshold : nombre d'acheteurs distincts sur UN événement, dans la fenêtre
--     de mesure, au-delà duquel la file s'arme d'elle-même.
--   waiting_room_capacity : sessions de paiement simultanées autorisées une fois armée.
--   waiting_room_window_seconds : durée de la fenêtre de mesure de l'affluence.
INSERT INTO public.platform_config (key, value) VALUES
  ('waiting_room_threshold', '80'),
  ('waiting_room_capacity', '50'),
  ('waiting_room_active_minutes', '10'),
  ('waiting_room_window_seconds', '60')
ON CONFLICT (key) DO NOTHING;

-- Mise en vente programmée : le seul cas où prédire bat mesurer. Une ouverture annoncée à
-- 10 h pile passe de zéro à des milliers d'acheteurs en deux secondes — trop vite pour
-- qu'une mesure sur une fenêtre glissante ait le temps de réagir. La file démarre alors
-- pré-armée. C'est une exception cochée sciemment, plus un arbitrage imposé à chacun.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS scheduled_onsale BOOLEAN DEFAULT false;

-- Reprend l'intention des organisateurs qui avaient coché l'ancienne case : s'ils attendaient
-- une forte demande, ils voulaient bien une file dès la première seconde.
UPDATE public.events SET scheduled_onsale = true
 WHERE waiting_room_enabled = true AND scheduled_onsale IS DISTINCT FROM true;

-- Affluence observée. Une ligne par acheteur et par événement, rafraîchie à chaque passage :
-- compter des acheteurs DISTINCTS évite qu'un seul visiteur qui recharge sa page ne déclenche
-- une file à lui tout seul.
CREATE TABLE IF NOT EXISTS public.event_pressure (
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_pressure_seen ON public.event_pressure (event_id, seen_at);

ALTER TABLE public.event_pressure ENABLE ROW LEVEL SECURITY;
-- Aucune policy anon/authenticated : alimentée exclusivement par le backend.

-- Enregistre le passage d'un acheteur et renvoie de quoi décider, en UN aller-retour.
--
-- Renvoie aussi le nombre de personnes en file : une fois armée, la salle d'attente le reste
-- tant que quelqu'un patiente. Sans cette règle, une accalmie la désarmerait et les arrivants
-- passeraient devant ceux qui attendent déjà — l'injustice exacte qu'une file existe pour
-- empêcher.
CREATE OR REPLACE FUNCTION public.waiting_room_gate(
  p_event_id TEXT,
  p_user_id TEXT,
  p_window_seconds INTEGER
)
RETURNS TABLE (pressure INTEGER, waiting INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.event_pressure AS e (event_id, user_id, seen_at)
  VALUES (p_event_id, p_user_id, now())
  ON CONFLICT (event_id, user_id) DO UPDATE SET seen_at = now();

  -- Purge bornée à cet événement : la table ne garde que la fenêtre courante.
  DELETE FROM public.event_pressure
   WHERE event_id = p_event_id
     AND seen_at < now() - (p_window_seconds || ' seconds')::interval;

  RETURN QUERY SELECT
    (SELECT count(*)::int FROM public.event_pressure WHERE event_id = p_event_id),
    (SELECT count(*)::int FROM public.waiting_room_entries
      WHERE event_id = p_event_id AND status = 'waiting');
END;
$$;

REVOKE ALL ON FUNCTION public.waiting_room_gate(TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiting_room_gate(TEXT, TEXT, INTEGER) TO service_role;

-- ==========================================
-- 27. CATÉGORIES : UN VRAI RÉFÉRENTIEL
-- ==========================================
-- Une catégorie n'était rien d'autre qu'un texte libre dans events.category, sans référentiel
-- ni contrainte, et DEUX listes codées en dur devaient s'accorder sans rien pour les y forcer :
-- celle du formulaire organisateur et celle des filtres de la page d'accueil. Elles avaient
-- déjà divergé — "Professionnel" était proposé à la création mais n'avait aucune puce de
-- filtre, si bien qu'une conférence n'était trouvable que sous "Tous".
--
-- Le filtre comparait par ailleurs les libellés par ÉGALITÉ STRICTE : une majuscule, un accent
-- ou une espace de différence et la catégorie devenait silencieusement introuvable, alors même
-- que l'API acceptait n'importe quel texte de moins de 100 caractères.
--
-- Le référentiel vit donc en base, avec une clé stable (le "slug", normalisé) distincte du
-- libellé affiché. Renommer "Théâtre & Humour" en "Spectacles" devient un changement
-- d'affichage qui ne casse aucun filtre et ne touche à aucun événement.

-- Normalise un libellé en clé stable : minuscules, sans accent, séparateurs réduits à un
-- tiret. "Théâtre & Humour" et "theatre et humour" donnent la même clé.
CREATE OR REPLACE FUNCTION public.slugify_category(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' from regexp_replace(
    lower(translate(COALESCE(p_text, ''),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy')),
    '[^a-z0-9]+', '-', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.categories (
    slug TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    -- Nom d'icône lucide-react, résolu côté frontend par une table de correspondance
    -- explicite : une icône inconnue retombe sur une icône neutre plutôt que de faire
    -- planter le rendu.
    icon TEXT NOT NULL DEFAULT 'Tag',
    sort_order INTEGER NOT NULL DEFAULT 100,
    -- Une catégorie désactivée n'est plus proposée à la création ni affichée en filtre, mais
    -- les événements qui la portent restent parfaitement visibles. C'est ce qui permet de
    -- retirer une catégorie sans toucher à l'historique.
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.categories (slug, label, icon, sort_order) VALUES
  ('concert',        'Concert',           'Music',       10),
  ('festivals',      'Festivals',         'PartyPopper', 20),
  ('theatre-humour', 'Théâtre & Humour',  'Drama',       30),
  ('sport',          'Sport',             'Trophy',      40),
  ('professionnel',  'Professionnel',     'Briefcase',   50)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Lecture publique : le catalogue est lu directement depuis le navigateur avec la clé anon
-- (cf. section 15), et les filtres ont besoin de cette liste. Rien de sensible ici — ce sont
-- les mêmes libellés que ceux affichés sur la page d'accueil. L'écriture reste réservée au
-- backend (service_role), qui contourne RLS par conception.
DROP POLICY IF EXISTS "Public read access to active categories" ON public.categories;
CREATE POLICY "Public read access to active categories"
  ON public.categories FOR SELECT
  USING (active = true);

-- Clé portée par l'événement, à côté du libellé historique qui reste la valeur d'affichage.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS category_slug TEXT;

UPDATE public.events SET category_slug = public.slugify_category(category)
 WHERE category_slug IS NULL;

-- Toute catégorie libre déjà présente en base devient une vraie catégorie, mais DÉSACTIVÉE :
-- les événements concernés restent visibles et cohérents, sans pour autant faire apparaître
-- sur la page d'accueil une puce issue d'une saisie approximative. À l'administrateur de
-- l'activer si elle mérite d'exister.
INSERT INTO public.categories (slug, label, icon, sort_order, active)
SELECT s, max(lbl), 'Tag', 900, false
  FROM (SELECT public.slugify_category(category) AS s, category AS lbl FROM public.events) x
 WHERE s <> ''
 GROUP BY s
ON CONFLICT (slug) DO NOTHING;

-- L'intégrité référentielle est posée APRÈS le rattrapage ci-dessus, donc sans rien rejeter
-- de l'existant. ON UPDATE CASCADE : renommer une clé suit les événements.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_category_slug_fkey') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_category_slug_fkey
      FOREIGN KEY (category_slug) REFERENCES public.categories(slug) ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_category_slug ON public.events (category_slug);

-- La vue publique doit exposer la clé, sans quoi le filtrage du catalogue lu directement
-- depuis le navigateur retomberait sur la comparaison de libellés qu'on remplace ici.
--
-- Corrige au passage une omission : la vue exposait encore waiting_room_enabled/capacity,
-- colonnes remplacées par scheduled_onsale (section 26). Le catalogue lu en direct recevait
-- donc un scheduled_onsale toujours vide, et l'avertissement de file d'attente ne s'affichait
-- jamais sur une mise en vente programmée.
DROP VIEW IF EXISTS public.events_public;

CREATE VIEW public.events_public
WITH (security_invoker = true) AS
SELECT
  id, title, description, date, time, end_date, end_time, price, ticket_types, venue,
  category, category_slug, banner, tickets_sold, total_tickets, organizer_id, organizer_name,
  status, created_at, scheduled_onsale
FROM public.events;

GRANT SELECT ON public.events_public TO anon, authenticated;

-- ==========================================
-- 28. CONTRÔLE D'ACCÈS HORS LIGNE
-- ==========================================
-- Le contrôle à l'entrée exigeait une connexion : chaque scan appelait /api/verify-ticket et
-- attendait la réponse. À l'entrée d'une salle, quand deux mille personnes arrivent en même
-- temps avec leur téléphone, le réseau mobile sature — c'est le régime normal d'une soirée,
-- pas l'incident rare. Le contrôle s'arrêtait alors net.
--
-- Le scanner télécharge désormais la liste des billets avant l'ouverture des portes, valide
-- localement quand le réseau manque, et resynchronise au retour. Ces colonnes tracent ce qui
-- s'est passé et où.

-- Appareil ayant enregistré le passage, et régime dans lequel il l'a fait. Sans ces deux
-- informations, un doublon constaté à la synchronisation est inexploitable : on sait qu'un
-- billet est passé deux fois, sans pouvoir dire à quelle porte ni dans quelles conditions.
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS scanned_device TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS scan_source TEXT; -- 'online' | 'offline'

-- Doublons constatés à la synchronisation.
--
-- Deux portes, deux téléphones hors ligne, le même billet présenté aux deux : les deux
-- acceptent, puisque aucun ne sait ce que l'autre a vu. C'est inhérent à la validation hors
-- ligne, et le parti pris est ASSUMÉ : on laisse entrer et on signale. Bloquer la file pour
-- un doublon rare coûterait plus cher que la fraude qu'on éviterait — un porteur légitime
-- refoulé à la porte est un incident bien plus fréquent et bien plus grave.
--
-- Cette table est donc la contrepartie de ce choix : elle rend la fraude visible après coup,
-- avec de quoi l'instruire.
CREATE TABLE IF NOT EXISTS public.scan_conflicts (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    event_id TEXT,
    -- Appareil et instant du passage refusé (le second)
    device_id TEXT,
    attempted_at TIMESTAMPTZ NOT NULL,
    -- Appareil et instant du passage retenu (le premier)
    existing_device TEXT,
    existing_scanned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_conflicts_event ON public.scan_conflicts (event_id, created_at DESC);

ALTER TABLE public.scan_conflicts ENABLE ROW LEVEL SECURITY;
-- Aucune policy anon/authenticated : alimentée et lue exclusivement par le backend.
