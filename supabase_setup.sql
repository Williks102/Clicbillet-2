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
