-- ==========================================
-- SCHEMA DE CONFIGURATION POUR SUPABASE (POSTGRESQL)
-- Projet : ClicBillet
-- ==========================================
-- Copiez et collez ce script dans l'éditeur SQL de votre projet Supabase (SQL Editor -> New Query).

-- 1. Table des UTILISATEURS (Users)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client', -- 'admin', 'client', 'organizer'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Table des ÉVÉNEMENTS (Events)
CREATE TABLE IF NOT EXISTS public.events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    date TEXT NOT NULL, -- Format YYYY-MM-DD
    time TEXT NOT NULL, -- Format HH:MM
    price NUMERIC NOT NULL DEFAULT 0,
    ticket_types JSONB, -- custom tickets tiers
    venue TEXT NOT NULL,
    category TEXT NOT NULL,
    banner TEXT,
    tickets_sold INTEGER DEFAULT 0,
    total_tickets INTEGER NOT NULL,
    organizer_id TEXT NOT NULL,
    organizer_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2bis. Colonnes ajoutées après la création initiale de la table : si "public.events"
-- existait déjà avant leur introduction dans ce script, CREATE TABLE IF NOT EXISTS ne les
-- aurait pas ajoutées. On les rattrape ici de façon idempotente (cause du précédent
-- "column events.status does not exist").
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS ticket_types JSONB;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- 3. Table des RETRAITS (Payouts)
-- details (numéro mobile money / IBAN) est chiffré applicativement avant écriture
-- (server/lib/payoutEncryption.ts, AES-256-GCM) : la colonne reste TEXT, mais ne contient
-- jamais la coordonnée en clair, y compris pour un accès direct à la base (service_role,
-- dump, etc.) contournant l'application. Seul GET /api/admin/payouts la déchiffre, pour
-- affichage à l'admin qui doit effectuer le virement.
CREATE TABLE IF NOT EXISTS public.payouts (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL,
    organizer_name TEXT,
    amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'rejected'
    request_date TEXT NOT NULL,
    method TEXT NOT NULL,
    details TEXT
);

-- 4. Table des TRANSACTIONS (Transactions log)
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    buyer_email TEXT,
    amount NUMERIC NOT NULL,
    status TEXT NOT NULL, -- 'success', 'failed', 'pending'
    date TEXT NOT NULL,
    method TEXT NOT NULL,
    error_details TEXT
);

-- 5. Table des BILLETS (Tickets)
CREATE TABLE IF NOT EXISTS public.tickets (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES public.events(id) ON DELETE CASCADE,
    event_title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_time TEXT NOT NULL,
    event_venue TEXT NOT NULL,
    buyer_id TEXT NOT NULL,
    buyer_name TEXT,
    buyer_email TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'standard', -- 'standard', 'vip'
    price_paid NUMERIC NOT NULL DEFAULT 0,
    qr_code_data TEXT NOT NULL UNIQUE,
    scanned BOOLEAN DEFAULT false,
    scanned_at TEXT,
    transaction_ref TEXT NOT NULL UNIQUE,
    purchase_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    quantity INTEGER DEFAULT 1
);

-- 5bis. Même rattrapage que pour events (cf. section 2bis) pour "quantity", ajoutée
-- après la création initiale de "public.tickets".
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;

-- 5quater. Une commande (ORD-xxxxx, référence envoyée à la passerelle de paiement) peut désormais
-- contenir plusieurs types de billets (ex: 2 Standard + 1 VIP) : chaque type devient sa
-- propre ligne "tickets" (son propre QR code, son propre transaction_ref unique), reliées
-- entre elles par order_id. NULL pour les billets créés avant cette migration (compatibilité
-- conservée : la confirmation de paiement retombe sur id/transaction_ref si order_id absent).
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON public.tickets (order_id);

-- 5ter. Salle d'attente virtuelle (activable par événement, pour les pics de trafic sur
-- une vente très demandée). Désactivée par défaut : aucun changement de comportement pour
-- les événements existants.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS waiting_room_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS waiting_room_capacity INTEGER DEFAULT 50;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS waiting_room_active_minutes INTEGER DEFAULT 10;

CREATE TABLE IF NOT EXISTS public.waiting_room_entries (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting', -- 'waiting' | 'active' | 'expired'
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    active_until TIMESTAMP WITH TIME ZONE,
    UNIQUE (event_id, user_id)
);

ALTER TABLE public.waiting_room_entries ENABLE ROW LEVEL SECURITY;
-- Pas de policy anon/authenticated : accès exclusif via la clé service_role (server.ts),
-- comme les autres tables sensibles (cf. section 8 ci-dessous).

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

-- 6. Insertion d'utilisateurs par défaut pour tester les connexions
-- NOTE: Pour des raisons de sécurité, les comptes de démonstration ne sont pas insérés avec des mots de passe en clair dans ce script.
-- Créez plutôt les utilisateurs via Supabase Auth ou lancez un processus d'inscription sécurisé.
-- INSERT INTO public.users (id, name, email, password, role)
-- VALUES 
-- ('usr-admin', 'Administrateur ClicBillet', 'admin@clicbillet.ci', '<hash>', 'admin'),
-- ('usr-client', 'Jean-Eudes Koffi', 'client@clicbillet.ci', '<hash>', 'client'),
-- ('org-1', 'Overcom Production', 'orga@clicbillet.ci', '<hash>', 'organizer')
-- ON CONFLICT (id) DO NOTHING;

-- 7. Insertion de quelques événements de démonstration initiaux
INSERT INTO public.events (id, title, description, date, time, price, venue, category, banner, tickets_sold, total_tickets, organizer_id, organizer_name, status)
VALUES 
('evt-1', 'Concert Géant de Didi B (Live à l''Agora d''Abobo)', 'Le Shogun de la musique ivoirienne Didi B vous donne rendez-vous pour un concert d''anthologie à l''Agora d''Abobo', '2026-07-25', '18:00', 5000, 'Agora d''Abobo, Abidjan', 'Concert', 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&auto=format&fit=crop&q=60', 345, 1500, 'org-1', 'Overcom Production', 'approved'),
('evt-2', 'Festival des Grillades d''Abidjan - 19ème Édition', 'Le plus grand événement gastronomique de Côte d''Ivoire !', '2026-08-15', '12:00', 3000, 'Palais de la Culture, Treichville, Abidjan', 'Festivals', 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=60', 1205, 5000, 'org-1', 'Overcom Production', 'approved'),
('evt-3', 'Le Parlement du Rire : Gohou, Boukary & Amis', 'Une thérapie par le rire d''une intensité folle !', '2026-06-30', '20:00', 10000, 'Salle Anoumabo, Palais de la Culture', 'Théâtre & Humour', 'https://images.unsplash.com/photo-1516280440614-37939bbacd6a?w=800&auto=format&fit=crop&q=60', 180, 1200, 'org-1', 'Overcom Production', 'approved'),
('evt-4', 'Super Classico Maracana : Abidjan vs Yamoussoukro', 'La grande finale de la ligue nationale de Maracana de Côte d''Ivoire.', '2026-07-12', '15:00', 2000, 'Forum de l''Université de Cocody, Abidjan', 'Sport', 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60', 67, 800, 'org-2', 'Fédération Maracana CI', 'approved')
ON CONFLICT (id) DO NOTHING;

-- 8. Row Level Security (RLS)
-- Le serveur applicatif (server.ts) accède toujours à ces tables via la clé service_role,
-- qui contourne RLS par conception. Le frontend n'utilise jamais le client Supabase
-- directement (toutes les requêtes passent par server.ts). RLS est donc activé ici en
-- défense en profondeur : si la clé anon venait à fuiter ou à être mal utilisée un jour,
-- elle ne doit donner accès à rien d'autre que le catalogue public d'événements approuvés.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to approved events" ON public.events;
CREATE POLICY "Public read access to approved events"
  ON public.events
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- Aucune autre policy n'est définie pour anon/authenticated sur users, events (écriture),
-- tickets, payouts et transactions : RLS sans policy correspondante revient à un refus
-- par défaut pour ces clients. Seule la clé service_role (utilisée exclusivement par
-- server.ts, jamais exposée au frontend) peut lire/écrire ces données.

-- ==========================================
-- 8bis. SUPABASE REALTIME — confirmation de paiement instantanée
-- ==========================================
-- Exception scoped à l'architecture "frontend ne touche jamais Supabase directement" :
-- le frontend s'abonne en lecture seule aux changements de SES PROPRES tickets (via son
-- propre JWT Supabase Auth, déjà émis au login) pour afficher un toast dès que le paiement
-- est confirmé côté serveur, sans avoir à repasser par /api/*. Aucune autre table n'est
-- concernée, et l'écriture continue de passer exclusivement par server.ts (service_role).

DROP POLICY IF EXISTS "tickets_select_own" ON public.tickets;
CREATE POLICY "tickets_select_own"
  ON public.tickets
  FOR SELECT
  TO authenticated
  USING (buyer_id = (auth.uid())::text);

-- Replica identity FULL nécessaire pour que les événements UPDATE de Realtime incluent
-- l'ancienne valeur des colonnes (notamment transaction_ref), indispensable pour détecter
-- côté client la transition "PENDING-..." -> "PAID-...". Par défaut (REPLICA IDENTITY
-- DEFAULT), seule la clé primaire est incluse dans le "old record".
ALTER TABLE public.tickets REPLICA IDENTITY FULL;

-- Active la réplication realtime sur la table tickets. Ce script étant destiné à être
-- recollé en entier à chaque nouvelle section (cf. les nombreux "IF NOT EXISTS" plus haut),
-- ALTER PUBLICATION ... ADD TABLE n'a lui-même aucune clause idempotente : relancer le
-- script une deuxième fois échouait sur "relation is already member of publication", ce qui
-- empêchait aussi toute section ajoutée après celle-ci de s'exécuter. Si le bloc échoue avec
-- "publication supabase_realtime does not exist", utilisez plutôt le Dashboard :
-- Database > Replication > activez la table "tickets".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
  END IF;
END $$;

-- ==========================================
-- 9. WEBHOOK DE BIENVENUE (Supabase -> Resend)
-- ==========================================
-- Objectif : à chaque INSERT dans public.users, notifier server.ts qui envoie
-- l'email de bienvenue via Resend (+ notification admin si l'utilisateur est organisateur).
--
-- MÉTHODE RECOMMANDÉE (sans SQL) : Dashboard Supabase
--   1. Database > Webhooks > Create a new webhook
--   2. Table : public.users      Events : Insert
--   3. Type : HTTP Request       Method : POST
--   4. URL : https://<votre-domaine-app>/api/webhooks/supabase/new-user
--   5. HTTP Headers : Authorization = Bearer <SUPABASE_WEBHOOK_SECRET>
--      (la même valeur que la variable d'environnement SUPABASE_WEBHOOK_SECRET de server.ts)
--
-- ALTERNATIVE (infra-as-code) : trigger SQL utilisant l'extension pg_net.
-- Décommentez et remplacez les deux placeholders avant exécution.
--
-- CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- CREATE OR REPLACE FUNCTION public.notify_new_user_webhook()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   PERFORM net.http_post(
--     url := 'https://<votre-domaine-app>/api/webhooks/supabase/new-user',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SUPABASE_WEBHOOK_SECRET>'
--     ),
--     body := jsonb_build_object(
--       'type', 'INSERT',
--       'table', 'users',
--       'schema', 'public',
--       'record', to_jsonb(NEW)
--     )
--   );
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;
--
-- DROP TRIGGER IF EXISTS trg_notify_new_user ON public.users;
-- CREATE TRIGGER trg_notify_new_user
-- AFTER INSERT ON public.users
-- FOR EACH ROW EXECUTE FUNCTION public.notify_new_user_webhook();

-- ==========================================
-- 10. RÉINITIALISATION DE MOT DE PASSE (mot de passe oublié)
-- ==========================================
-- Jetons à usage unique générés par /api/auth/forgot-password. On ne stocke jamais le jeton
-- en clair (seulement son hash SHA-256), comme pour un mot de passe : si la table fuyait, les
-- jetons (et donc la possibilité de réinitialiser un mot de passe) ne seraient pas exploitables.
CREATE TABLE IF NOT EXISTS public.password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON public.password_resets (user_id);

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
-- Pas de policy anon/authenticated : accès exclusif via la clé service_role (server.ts),
-- comme les autres tables sensibles (cf. section 8 ci-dessus).

-- ==========================================
-- 11. CONFIGURATION PLATEFORME — taux de commission
-- ==========================================
-- Remplace la constante `commissionRate` auparavant codée en dur à plusieurs endroits de
-- server.ts. Le taux par défaut vit ici ; un événement peut le surcharger individuellement
-- (accord négocié avec un organisateur, offre promotionnelle) via events.commission_rate.
CREATE TABLE IF NOT EXISTS public.platform_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ON CONFLICT DO NOTHING : ne sert qu'à l'installation initiale (première exécution du
-- script sur une base vide). Si cette ligne existe déjà avec l'ancienne valeur '0.10', ce
-- INSERT ne la met PAS à jour silencieusement — voir la migration ponctuelle ci-dessous.
INSERT INTO public.platform_config (key, value)
VALUES ('ticket_commission_rate', '0.06')
ON CONFLICT (key) DO NOTHING;

-- MIGRATION PONCTUELLE (à exécuter une seule fois si '0.10' était déjà en base) : passage du
-- taux de commission plateforme de 10% à 6%. Contrairement à l'INSERT ci-dessus (conçu pour
-- être rejoué sans risque), cette UPDATE est volontairement tenue à part du script principal
-- pour ne jamais écraser un taux ajusté manuellement après coup par un administrateur.
UPDATE public.platform_config SET value = '0.06', updated_at = now()
WHERE key = 'ticket_commission_rate' AND value = '0.10';

ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
-- Pas de policy anon/authenticated : accès exclusif via la clé service_role (server.ts),
-- comme les autres tables sensibles (cf. section 8 ci-dessus).

-- Surcharge de commission par événement (accord négocié / offre promo). NULL = utilise le
-- taux par défaut de platform_config ci-dessus.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS commission_rate NUMERIC;

-- ==========================================
-- 12. LECTURE PUBLIQUE DIRECTE (contournement du cold start serverless)
-- ==========================================
-- La liste publique d'événements (page d'accueil) passait jusqu'ici par /api/events
-- (fonction serverless Vercel), sujette au cold start. La RLS section 8 autorise déjà la
-- lecture publique de public.events (status = 'approved') : le frontend peut donc lire
-- ces données directement via le client Supabase (clé anon), sans passer par server.ts.
-- (Depuis la section 15, cette lecture directe se fait via la vue events_public plutôt que
-- sur la table events elle-même, dont le SELECT direct par anon/authenticated est révoqué.)
--
-- Seule la disponibilité par palier (ticketsSoldByTier, cf. /api/events) nécessite encore
-- une fonction dédiée : elle est calculée à partir de public.tickets, dont la RLS
-- (tickets_select_own) ne donne accès qu'à SES PROPRES billets. Cette fonction SECURITY
-- DEFINER expose uniquement des compteurs agrégés (event_id, tier, nombre vendu) — aucune
-- donnée acheteur — soit exactement ce que /api/events affichait déjà publiquement sur
-- chaque carte événement, sans élargir la surface d'exposition.
CREATE OR REPLACE FUNCTION public.get_public_events_tier_sold()
RETURNS TABLE(event_id TEXT, tier TEXT, sold BIGINT) AS $$
  SELECT t.event_id, t.tier, COUNT(*) AS sold
  FROM public.tickets t
  JOIN public.events e ON e.id = t.event_id
  WHERE e.status = 'approved'
    AND t.transaction_ref NOT LIKE 'PENDING-%'
    AND t.transaction_ref NOT LIKE 'FAILED-%'
  GROUP BY t.event_id, t.tier;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.get_public_events_tier_sold() TO anon, authenticated;

-- ==========================================
-- 13. PAGES PUBLIQUES ORGANISATEUR (alias + bio)
-- ==========================================
-- Chaque organisateur peut choisir un alias public (ex: "kader-events") donnant accès à
-- une page /o/<alias> regroupant ses événements. L'unicité est vérifiée côté application
-- (GET /api/organizer/check-alias) et garantie ici en dernier recours par l'index unique
-- ci-dessous (insensible à la casse, ignore les organisateurs sans alias défini).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS organizer_alias TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS organizer_bio TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_organizer_alias_unique
  ON public.users (LOWER(organizer_alias))
  WHERE organizer_alias IS NOT NULL;

-- public.users n'a aucune policy RLS publique (email/mot de passe/rôle ne doivent jamais
-- être lisibles par la clé anon) : pour que la page d'accueil (lue en direct par le
-- frontend, cf. section 12) puisse rendre le nom d'organisateur cliquable, on expose
-- uniquement (id, organizer_alias) via une fonction SECURITY DEFINER, même principe que
-- get_public_events_tier_sold ci-dessus.
CREATE OR REPLACE FUNCTION public.get_organizer_aliases(organizer_ids TEXT[])
RETURNS TABLE(id TEXT, organizer_alias TEXT) AS $$
  SELECT u.id, u.organizer_alias
  FROM public.users u
  WHERE u.id = ANY(organizer_ids) AND u.organizer_alias IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.get_organizer_aliases(TEXT[]) TO anon, authenticated;

-- ==========================================
-- 14. VERROUILLAGE PROGRESSIF PAR COMPTE (anti-bruteforce)
-- ==========================================
-- Le rate limiting existant sur /api/auth/login (server/lib/rateLimiters.ts) est appliqué
-- par IP : un attaquant disposant de plusieurs IP (proxies/botnet) peut toujours tenter de
-- deviner le mot de passe d'un compte précis en répartissant les tentatives. Ce compteur,
-- tenu par compte (pas par IP), verrouille temporairement le compte lui-même après plusieurs
-- échecs consécutifs, indépendamment de l'origine des requêtes.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- ==========================================
-- 15. VUE PUBLIQUE SANS COLONNES SENSIBLES (events_public)
-- ==========================================
-- La policy RLS "Public read access to approved events" (section 8) filtre les LIGNES
-- (status = 'approved'), pas les COLONNES : un SELECT * direct via la clé anon (cf.
-- src/lib/publicEvents.ts) expose donc aussi commission_rate — le taux de commission négocié
-- individuellement avec chaque organisateur, une donnée commerciale sensible qui ne doit pas
-- être extractible par un visiteur interrogeant directement Supabase. Cette vue n'expose que
-- les colonnes réellement publiques ; security_invoker=true fait que la RLS de la table
-- sous-jacente (donc le filtre status='approved') continue de s'appliquer normalement pour
-- le rôle appelant (anon/authenticated), plutôt que de la contourner comme le ferait une vue
-- SECURITY DEFINER classique.
-- DROP puis CREATE, et non CREATE OR REPLACE : la section 20 redéfinit plus bas cette même
-- vue avec end_date/end_time. Sur une base où la section 20 a déjà été jouée, un
-- CREATE OR REPLACE ici tenterait de RETIRER ces deux colonnes — ce que PostgreSQL refuse
-- (ERROR 42P16 « cannot drop columns from view »), rendant le script non rejouable.
-- Les colonnes de fin ne peuvent pas être listées ici : elles ne sont ajoutées à la table
-- qu'en section 20, plus bas. La vue prend donc sa forme définitive à ce moment-là.
DROP VIEW IF EXISTS public.events_public;

CREATE VIEW public.events_public
WITH (security_invoker = true) AS
SELECT
  id, title, description, date, time, price, ticket_types, venue, category, banner,
  tickets_sold, total_tickets, organizer_id, organizer_name, status, created_at,
  waiting_room_enabled, waiting_room_capacity
FROM public.events;

GRANT SELECT ON public.events_public TO anon, authenticated;

-- La vue seule ne suffit pas : Supabase accorde par défaut SELECT sur toutes les tables du
-- schéma public à anon/authenticated (la policy RLS ci-dessus ne fait que filtrer les lignes
-- de ce SELECT déjà accordé). Sans cette révocation, un appel direct à l'API REST du type
-- GET /rest/v1/events?select=id,commission_rate avec la clé anon continuerait de fonctionner
-- et de contourner entièrement la vue events_public.
REVOKE SELECT ON public.events FROM anon, authenticated;

-- Le frontend (src/lib/publicEvents.ts) doit désormais interroger events_public au lieu de
-- events directement. La table events elle-même reste pleinement lisible/inscriptible par
-- service_role (server.ts, qui contourne RLS et les grants de rôle par conception) ; seule
-- la lecture directe par anon/authenticated est désormais bornée à events_public (colonnes
-- non sensibles uniquement).

-- ==========================================
-- 16. POLITIQUE DE RÉTENTION DES DONNÉES
-- ==========================================
-- Résumé de ce qui est conservé, purgé, ou ni l'un ni l'autre, et pourquoi. Le mécanisme de
-- purge automatique est implémenté dans server/routes/tickets.ts
-- (GET /api/cron/expire-pending-tickets), appelé périodiquement par un planificateur externe.
--
-- PURGÉ AUTOMATIQUEMENT (aucune valeur passé le délai, PII résiduel sans raison) :
--   - public.tickets dont transaction_ref commence par "EXPIRED-" ou "FAILED-" (panier
--     abandonné ou paiement refusé, jamais payé) : supprimés après ABANDONED_TICKET_RETENTION_DAYS
--     (server/lib/config.ts, 90 jours par défaut). Un billet payé (tout autre préfixe :
--     "PAID-", "FREE-", la référence Paystack d'origine, etc.) n'est JAMAIS concerné par cette
--     purge, quel que soit son âge.
--   - public.password_resets dont expires_at est dépassée : supprimés dès l'expiration (déjà
--     rejetés par la route reset-password de toute façon, aucune fenêtre de grâce nécessaire).
--
-- CONSERVÉS INDÉFINIMENT (aucune purge automatique) :
--   - Billets payés, public.events, public.transactions : pièces comptables/justificatifs
--     d'entrée à l'événement. La durée légale de conservation des documents comptables/
--     fiscaux en Côte d'Ivoire (ou toute autre juridiction concernée) est une décision qui
--     revient à la plateforme et à son conseil juridique/comptable — elle n'est pas figée en
--     dur ici, volontairement, plutôt que d'inventer une durée arbitraire.
--   - public.users : le compte et son historique restent tant qu'il n'y a pas de demande
--     explicite de suppression (cf. DELETE /api/admin/users/:id, server/routes/admin.ts, qui
--     supprime à la fois le profil et le compte Supabase Auth sous-jacent).
--   - public.payouts.details : chiffré au repos (server/lib/payoutEncryption.ts) plutôt que
--     purgé, puisqu'il s'agit d'un justificatif de virement à conserver au même titre que les
--     autres pièces comptables.

-- ==========================================
-- 17. HISTORIQUE DES TRANSFERTS DE BILLETS
-- ==========================================
-- Un transfert (cf. POST /api/tickets/:id/transfer) réattribue directement le billet à son
-- nouveau propriétaire (tickets.buyer_id/buyer_name/buyer_email), donc l'expéditeur perd toute
-- trace de ce billet dans /api/my-tickets (filtré par buyer_id). Cette table ne gouverne aucune
-- règle métier : c'est un historique en lecture seule ("Billets transférés" / "Mes billets
-- reçus" côté espace client), une ligne immuable par transfert effectué.
CREATE TABLE IF NOT EXISTS public.ticket_transfers (
    id TEXT PRIMARY KEY,
    ticket_id TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
    event_title TEXT,
    event_date TEXT,
    event_time TEXT,
    event_venue TEXT,
    tier TEXT,
    price_paid NUMERIC,
    from_user_id TEXT NOT NULL,
    from_name TEXT,
    from_email TEXT,
    to_name TEXT,
    to_email TEXT NOT NULL,
    transferred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_transfers_from_user ON public.ticket_transfers (from_user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_to_email ON public.ticket_transfers (to_email);

ALTER TABLE public.ticket_transfers ENABLE ROW LEVEL SECURITY;
-- Pas de policy anon/authenticated : accès exclusif via la clé service_role (server.ts),
-- comme les autres tables sensibles (cf. section 8).

-- ==========================================
-- 18. CODE PUBLIC UTILISATEUR (référence support)
-- ==========================================
-- Identifiant court et dictable au téléphone (ex: "CB-7K4P2M"), attribué à chaque compte et
-- affiché dans son espace, pour que le support retrouve une personne sans lui faire épeler son
-- UUID Supabase ni son adresse e-mail. Généré par l'application (server/lib/publicCode.ts).
--
-- CE CODE N'EST PAS UN SECRET : il ne donne aucun droit et n'authentifie rien. Aucune route ne
-- doit accorder d'accès sur sa seule présentation — il ne sert qu'à identifier un compte dans
-- une conversation de support, jamais à l'autoriser.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS public_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_public_code_unique
  ON public.users (UPPER(public_code))
  WHERE public_code IS NOT NULL;

-- Attribution aux comptes créés avant l'introduction de la colonne. L'application sait déjà le
-- faire à la volée à la connexion (ensureUserPublicCode), mais un compte qui ne s'est pas
-- reconnecté depuis la migration resterait sans code visible dans le back-office : ce bloc le
-- comble d'un coup. Idempotent — ne touche que les lignes dont public_code est NULL.
-- Même alphabet que server/lib/publicCode.ts (ni 0/O ni 1/I/L, confondus à l'oral).
DO $$
DECLARE
  target RECORD;
  candidate TEXT;
  alphabet TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  i INT;
BEGIN
  FOR target IN SELECT id FROM public.users WHERE public_code IS NULL LOOP
    LOOP
      candidate := 'CB-';
      FOR i IN 1..6 LOOP
        candidate := candidate || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE UPPER(public_code) = candidate);
    END LOOP;
    UPDATE public.users SET public_code = candidate WHERE id = target.id;
  END LOOP;
END $$;

-- ==========================================
-- 19. DEMANDES DE PASSAGE ACHETEUR -> ORGANISATEUR
-- ==========================================
-- Le rôle est choisi à l'inscription et n'était jusqu'ici modifiable par personne (ni par
-- l'utilisateur, ni par l'admin) : un acheteur voulant organiser devait recréer un compte avec
-- une autre adresse e-mail, en perdant l'historique de ses achats. Cette table porte la demande
-- et sa décision ; l'approbation (PATCH /api/admin/organizer-requests/:id) est le SEUL chemin
-- qui fait passer users.role de 'client' à 'organizer'.
--
-- Un compte organisateur encaisse de l'argent (payouts, commissions) : la bascule reste donc
-- volontairement soumise à validation humaine, jamais en libre-service.
CREATE TABLE IF NOT EXISTS public.organizer_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT,
    user_email TEXT,
    organization_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    motivation TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    review_note TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organizer_requests_user_id ON public.organizer_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_organizer_requests_status ON public.organizer_requests (status);

-- Une seule demande en attente à la fois par compte : sans cet index, un utilisateur pourrait
-- inonder la file de modération en soumettant le formulaire en boucle.
CREATE UNIQUE INDEX IF NOT EXISTS organizer_requests_one_pending_per_user
  ON public.organizer_requests (user_id)
  WHERE status = 'pending';

ALTER TABLE public.organizer_requests ENABLE ROW LEVEL SECURITY;
-- Pas de policy anon/authenticated : accès exclusif via la clé service_role (server.ts).

-- ==========================================
-- 20. DATE ET HEURE DE FIN D'ÉVÉNEMENT
-- ==========================================
-- events.date/time désignent le DÉBUT. Sans borne de fin, rien ne permettait de dire quand un
-- billet cesse d'être valide : GET /api/verify-ticket acceptait un billet payé et non scanné
-- indéfiniment, y compris des mois après l'événement. Sur un organisateur récurrent (soirée
-- hebdomadaire), le billet de la semaine passée ouvrait donc la porte de la suivante.
--
-- Ces colonnes restent NULLABLES : les événements créés avant cette migration n'en ont pas, et
-- retombent sur une durée forfaitaire (cf. EVENT_DEFAULT_DURATION_HOURS, server/lib/config.ts)
-- plutôt que de devenir non scannables du jour au lendemain.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS end_date TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS end_time TEXT;

-- La vue publique doit exposer ces colonnes, sans quoi le catalogue lu directement par le
-- frontend (cf. section 15) ne saurait pas quand un événement se termine réellement.
--
-- DROP puis CREATE, et non CREATE OR REPLACE : PostgreSQL n'autorise le remplacement d'une vue
-- que si les colonnes existantes gardent le même nom, le même type ET le même rang. Insérer
-- end_date/end_time après "time" décale toutes les suivantes, ce que le moteur interprète
-- comme un renommage de colonne et refuse (ERROR 42P16). Le DROP est volontairement sans
-- CASCADE : si un objet dépendait de cette vue, mieux vaut une erreur explicite que sa
-- suppression silencieuse. Le GRANT ci-dessous est indispensable — il disparaît avec la vue.
DROP VIEW IF EXISTS public.events_public;

CREATE VIEW public.events_public
WITH (security_invoker = true) AS
SELECT
  id, title, description, date, time, end_date, end_time, price, ticket_types, venue, category,
  banner, tickets_sold, total_tickets, organizer_id, organizer_name, status, created_at,
  waiting_room_enabled, waiting_room_capacity
FROM public.events;

GRANT SELECT ON public.events_public TO anon, authenticated;

-- ==========================================
-- 21. AGRÉGATS DE CHIFFRE D'AFFAIRES CALCULÉS EN BASE
-- ==========================================
-- L'API REST de Supabase renvoie au maximum 1 000 lignes par défaut. Or /api/admin/stats et
-- /api/organizer/stats ramenaient TOUS les billets pour additionner le chiffre d'affaires en
-- mémoire : au-delà de mille billets, le total affiché n'était plus qu'une fraction de la
-- réalité — silencieusement, sans erreur ni avertissement. Sur un jeu de 4 500 billets,
-- 78 % du chiffre d'affaires disparaissait.
--
-- Ces agrégats se calculent donc là où sont les données. Aucun plafond ne s'applique à une
-- agrégation, et la base rend en quelques millisecondes ce qui demandait de transférer puis
-- de parcourir toute la table dans une fonction serverless.
--
-- Miroir exact de computeCommissionBreakdown (server/lib/commission.ts), y compris ses deux
-- subtilités : seuls les billets réellement encaissés comptent (PAID-/FREE-, cf.
-- server/lib/ticketPayment.ts), et la commission est arrondie à l'entier inférieur ÉVÉNEMENT
-- PAR ÉVÉNEMENT avant sommation — chacun pouvant avoir son propre taux négocié, appliquer un
-- taux unique au total donnerait un autre résultat. L'égalité des deux implémentations a été
-- vérifiée au franc près sur 4 500 billets couvrant tous les états de paiement, des taux
-- négociés, un taux à 0 % et l'absence de taux.
CREATE OR REPLACE FUNCTION public.ticket_revenue_stats(p_organizer_id TEXT DEFAULT NULL)
RETURNS TABLE (
  total_gross_revenue NUMERIC,
  total_commission NUMERIC,
  total_organizer_payout NUMERIC,
  effective_commission_rate NUMERIC,
  total_tickets_sold BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH taux_defaut AS (
    SELECT COALESCE(
      (SELECT value::numeric FROM public.platform_config WHERE key = 'ticket_commission_rate'),
      0.06
    ) AS v
  ),
  payes AS (
    SELECT t.event_id, t.price_paid, t.quantity
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE (t.transaction_ref LIKE 'PAID-%' OR t.transaction_ref LIKE 'FREE-%')
      AND (p_organizer_id IS NULL OR e.organizer_id = p_organizer_id)
  ),
  par_evenement AS (
    SELECT p.event_id,
           SUM(p.price_paid) AS brut,
           SUM(COALESCE(p.quantity, 1)) AS billets,
           COALESCE(e.commission_rate, (SELECT v FROM taux_defaut)) AS taux
    FROM payes p
    JOIN public.events e ON e.id = p.event_id
    GROUP BY p.event_id, e.commission_rate
  ),
  totaux AS (
    SELECT COALESCE(SUM(brut), 0) AS brut,
           COALESCE(SUM(FLOOR(brut * taux)), 0) AS commission,
           COALESCE(SUM(billets), 0) AS billets
    FROM par_evenement
  )
  SELECT brut,
         commission,
         brut - commission,
         CASE WHEN brut > 0 THEN commission / brut ELSE (SELECT v FROM taux_defaut) END,
         billets::bigint
  FROM totaux;
$$;

-- Appelée exclusivement par le backend (service_role, cf. server/routes/admin.ts et
-- organizer.ts). Aucun accès anon/authenticated : ces chiffres sont commerciaux.
REVOKE ALL ON FUNCTION public.ticket_revenue_stats(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ticket_revenue_stats(TEXT) TO service_role;

-- ==========================================
-- 22. INDICATEURS DES RAPPORTS CALCULÉS EN BASE
-- ==========================================
-- Même motif que la section 21, appliqué cette fois aux onglets Rapports : ils
-- recalculaient taux de remplissage, taux d'entrée, taux d'abandon, répartition par tarif
-- et performance par événement dans le navigateur, à partir de la liste de billets reçue —
-- donc d'un échantillon plafonné, et au prix de plusieurs mégaoctets transférés.
--
-- ATTENTION à une subtilité conservée telle quelle : ici la commission est arrondie
-- BILLET PAR BILLET (SUM(FLOOR(...))), alors que ticket_revenue_stats l'arrondit
-- ÉVÉNEMENT PAR ÉVÉNEMENT. C'est la reproduction fidèle des deux implémentations
-- JavaScript existantes, qui divergent déjà entre elles de quelques francs. Les unifier
-- est un choix de gestion, pas une correction technique : à trancher séparément.
--
-- Les dates d'événement sont stockées en texte local ; la comparaison à now() est donc
-- juste tant que la base tourne en UTC, ce qui correspond au fuseau ivoirien (UTC+0).
-- Concordance vérifiée au franc près contre le calcul JavaScript sur 4 500 billets.
CREATE OR REPLACE FUNCTION public.ticket_report_stats(p_organizer_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH taux_defaut AS (
    SELECT COALESCE((SELECT value::numeric FROM public.platform_config WHERE key='ticket_commission_rate'), 0.06) AS v
  ),
  evenements AS (
    SELECT e.*, COALESCE(e.commission_rate, (SELECT v FROM taux_defaut)) AS taux,
           ((e.date || ' ' || e.time)::timestamp <= now()) AS commence
    FROM public.events e
    WHERE p_organizer_id IS NULL OR e.organizer_id = p_organizer_id
  ),
  billets AS (
    SELECT t.*, ev.taux, ev.commence,
           (t.transaction_ref LIKE 'PAID-%' OR t.transaction_ref LIKE 'FREE-%') AS paye
    FROM public.tickets t JOIN evenements ev ON ev.id = t.event_id
  ),
  payes AS (SELECT * FROM billets WHERE paye),
  indicateurs AS (
    SELECT
      COALESCE(SUM(COALESCE(quantity,1)),0)::bigint AS tickets_sold,
      COALESCE(SUM(price_paid),0) AS gross,
      COALESCE(SUM(FLOOR(price_paid * taux)),0) AS commission,
      COUNT(*) FILTER (WHERE commence)::bigint AS scannable_count,
      COUNT(*) FILTER (WHERE commence AND scanned)::bigint AS scanned_count
    FROM payes
  ),
  volumes AS (
    SELECT COUNT(*)::bigint AS total_rows, COUNT(*) FILTER (WHERE paye)::bigint AS paid_rows FROM billets
  ),
  capacite AS (SELECT COALESCE(SUM(total_tickets),0)::bigint AS capacity FROM evenements)
  SELECT jsonb_build_object(
    'ticketsSold', i.tickets_sold,
    'gross', i.gross,
    'commission', i.commission,
    'capacity', c.capacity,
    'scannableCount', i.scannable_count,
    'scannedCount', i.scanned_count,
    'totalTicketRows', v.total_rows,
    'paidTicketRows', v.paid_rows,
    'tiers', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT tier, SUM(price_paid) AS gross, SUM(COALESCE(quantity,1))::bigint AS count
        FROM payes GROUP BY tier ORDER BY SUM(price_paid) DESC) x), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(y) FROM (
        SELECT ev.id, ev.title, ev.date, ev.total_tickets AS capacity, ev.commence AS started,
               COALESCE(SUM(p.price_paid),0) AS gross,
               COALESCE(SUM(FLOOR(p.price_paid * ev.taux)),0) AS commission,
               COALESCE(SUM(COALESCE(p.quantity,1)),0)::bigint AS sold,
               COUNT(p.*)::bigint AS paid_rows,
               COUNT(p.*) FILTER (WHERE p.scanned)::bigint AS scanned
        FROM evenements ev LEFT JOIN payes p ON p.event_id = ev.id
        GROUP BY ev.id, ev.title, ev.date, ev.total_tickets, ev.commence
        ORDER BY COALESCE(SUM(p.price_paid),0) DESC) y), '[]'::jsonb),
    'series', COALESCE((SELECT jsonb_agg(z ORDER BY z.jour) FROM (
        SELECT date_trunc('day', purchase_date) AS jour,
               SUM(price_paid) AS gross,
               SUM(FLOOR(price_paid * taux)) AS commission
        FROM payes WHERE purchase_date >= now() - interval '365 days'
        GROUP BY 1) z), '[]'::jsonb)
  )
  FROM indicateurs i, volumes v, capacite c;
$$;

REVOKE ALL ON FUNCTION public.ticket_report_stats(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ticket_report_stats(TEXT) TO service_role;

-- ==========================================
-- 23. FILE D'ATTENTE DES E-MAILS SORTANTS
-- ==========================================
-- Les e-mails partaient en « meilleur effort » : un échec d'envoi n'était que journalisé, et
-- le message perdu. Sur le message le plus sensible du parcours — celui qui porte le QR code
-- d'un billet payé — cela signifie un client qui a payé et ne reçoit rien, sans que personne
-- ne s'en aperçoive avant sa réclamation.
--
-- Le débit y contribue : Resend accepte 10 requêtes par seconde et par équipe. Une mise en
-- vente qui écoule cent billets en quelques minutes dépasse ce seuil, et les envois refusés
-- l'étaient définitivement.
--
-- Cette table est donc un filet : tout envoi qui échoue y atterrit, et une route de
-- maintenance la vide par lots (l'API Resend accepte 100 messages par appel), avec un délai
-- de réessai croissant. Un e-mail n'est plus perdu, il est retardé — et ce qui a
-- définitivement échoué reste visible en base au lieu de disparaître dans les journaux.
CREATE TABLE IF NOT EXISTS public.email_outbox (
    id TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);

-- Index de drainage : la route de maintenance ne cherche que les messages dus, les plus
-- anciens d'abord. Sans lui, elle balaierait toute la table à chaque passage.
CREATE INDEX IF NOT EXISTS idx_email_outbox_due
    ON public.email_outbox (next_attempt_at)
    WHERE status = 'pending';

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
-- Aucune policy anon/authenticated : le contenu des messages (QR codes, liens de
-- réinitialisation) ne doit être lisible que par le backend, via la clé service_role.

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
