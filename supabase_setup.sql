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

-- Fait progresser la file d'attente d'un événement de façon atomique : expire les sessions
-- "active" dont le créneau est dépassé, puis promeut les entrées "waiting" les plus
-- anciennes pour remplir les places libérées. Appelée à chaque join/poll de statut côté
-- server.ts (pas de cron nécessaire) ; FOR UPDATE SKIP LOCKED évite les doubles promotions
-- si plusieurs requêtes arrivent en même temps.
CREATE OR REPLACE FUNCTION public.advance_waiting_room(p_event_id TEXT, p_capacity INT, p_active_minutes INT)
RETURNS void AS $$
BEGIN
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
-- Remplace la constante `commissionRate = 0.10` auparavant codée en dur à plusieurs endroits
-- de server.ts. Le taux par défaut vit ici ; un événement peut le surcharger individuellement
-- (accord négocié avec un organisateur, offre promotionnelle) via events.commission_rate.
CREATE TABLE IF NOT EXISTS public.platform_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.platform_config (key, value)
VALUES ('ticket_commission_rate', '0.10')
ON CONFLICT (key) DO NOTHING;

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
CREATE OR REPLACE VIEW public.events_public
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
