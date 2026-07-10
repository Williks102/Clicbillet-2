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

-- 5quater. Une commande (ORD-xxxxx, référence envoyée à PaiementPro) peut désormais
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

-- Active la réplication realtime sur la table tickets. Si cette commande échoue avec
-- "publication supabase_realtime does not exist", utilisez plutôt le Dashboard :
-- Database > Replication > activez la table "tickets".
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;

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
-- cette table directement via le client Supabase (clé anon), sans passer par server.ts.
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
-- 13. SYSTÈME DE VOTE (gratuit + premium payant)
-- ==========================================
-- Campagnes créées en self-service par les organisateurs (même workflow que les events,
-- sans validation admin préalable). Vote gratuit : 1 voix/candidat/électeur/jour (dédupliqué
-- via dedup_key). Vote premium : packs de voix payants via PaiementPro, même pattern
-- PENDING-/PAID- que les tickets (cf. transaction_ref sur public.tickets).
CREATE TABLE IF NOT EXISTS public.voting_campaigns (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL,
    organizer_name TEXT,
    event_id TEXT REFERENCES public.events(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    banner TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'active' | 'closed' | 'suspended'
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    free_vote_window_hours INTEGER NOT NULL DEFAULT 24,
    premium_vote_packs JSONB NOT NULL DEFAULT '[]', -- [{ "votes": 10, "price": 1000 }, ...]
    commission_rate NUMERIC, -- override optionnel, sinon platform_config.vote_commission_rate
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voting_campaigns_organizer_id ON public.voting_campaigns (organizer_id);

CREATE TABLE IF NOT EXISTS public.candidates (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES public.voting_campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    photo TEXT,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_candidates_campaign_id ON public.candidates (campaign_id);

CREATE TABLE IF NOT EXISTS public.votes (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES public.voting_campaigns(id) ON DELETE CASCADE,
    candidate_id TEXT NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    order_id TEXT, -- regroupe les lignes d'un même achat de pack premium
    type TEXT NOT NULL, -- 'free' | 'premium'
    quantity INTEGER NOT NULL DEFAULT 1,
    voter_user_id TEXT,
    voter_email TEXT,
    voter_phone TEXT,
    -- Dédup du vote gratuit : hash(campagne + candidat + identité électeur + jour), NULL pour le premium.
    dedup_key TEXT,
    transaction_ref TEXT, -- PENDING-VOTE-xxx / PAID-VOTE-xxx / FAILED-VOTE-xxx, NULL pour le gratuit (immédiatement définitif)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_votes_campaign_id ON public.votes (campaign_id);
CREATE INDEX IF NOT EXISTS idx_votes_candidate_id ON public.votes (candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_dedup_key_unique ON public.votes (dedup_key) WHERE type = 'free';

-- Log des tentatives d'achat de voix (montant, statut, moyen de paiement) — même rôle que
-- public.transactions pour les billets, utilisé pour les stats organisateur/admin.
CREATE TABLE IF NOT EXISTS public.vote_transactions (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    buyer_email TEXT,
    buyer_phone TEXT,
    votes_qty INTEGER NOT NULL,
    amount NUMERIC NOT NULL,
    status TEXT NOT NULL, -- 'pending' | 'paid' | 'failed'
    method TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.platform_config (key, value)
VALUES ('vote_commission_rate', '0.15')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.voting_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_transactions ENABLE ROW LEVEL SECURITY;

-- Lecture publique directe (même logique que la section 12 pour les events) : le frontend
-- lit les campagnes actives et leurs candidats directement via Supabase, sans passer par
-- server.ts. L'écriture (création/édition de campagne, enregistrement d'un vote) continue
-- de passer exclusivement par server.ts (service_role).
DROP POLICY IF EXISTS "Public read access to active campaigns" ON public.voting_campaigns;
CREATE POLICY "Public read access to active campaigns"
  ON public.voting_campaigns
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "Public read access to candidates of active campaigns" ON public.candidates;
CREATE POLICY "Public read access to candidates of active campaigns"
  ON public.candidates
  FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.voting_campaigns c
    WHERE c.id = candidates.campaign_id AND c.status = 'active'
  ));

-- Aucune policy anon/authenticated sur votes/vote_transactions (données électeur/paiement) :
-- accès exclusif via service_role, comme tickets/transactions. Les décomptes publics passent
-- par la fonction agrégée ci-dessous (aucune ligne individuelle, aucun email exposé).
CREATE OR REPLACE FUNCTION public.get_public_campaign_vote_counts(p_campaign_id TEXT)
RETURNS TABLE(candidate_id TEXT, votes BIGINT) AS $$
  SELECT v.candidate_id, COALESCE(SUM(v.quantity), 0) AS votes
  FROM public.votes v
  JOIN public.voting_campaigns c ON c.id = v.campaign_id
  WHERE v.campaign_id = p_campaign_id
    AND c.status = 'active'
    AND (v.transaction_ref IS NULL OR (v.transaction_ref NOT LIKE 'PENDING-%' AND v.transaction_ref NOT LIKE 'FAILED-%'))
  GROUP BY v.candidate_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.get_public_campaign_vote_counts(TEXT) TO anon, authenticated;

-- Réplication temps réel du décompte de voix (toast/mise à jour live côté organisateur et
-- électeurs), même mécanisme que public.tickets (cf. section 8bis).
ALTER TABLE public.votes REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.votes;

-- ==========================================
-- 14. SEEDS DE CAMPAGNES DE VOTE DE DÉMONSTRATION
-- ==========================================
-- Données d'exemple pour tester le parcours de vote sans avoir à créer une campagne
-- manuellement. Rattachées à l'organisateur de démo 'org-1' (cf. section 6/7 ci-dessus).
-- Dates glissantes (now() ± intervalle) pour rester "active" quel que soit le jour où ce
-- script est exécuté.
INSERT INTO public.voting_campaigns (id, organizer_id, organizer_name, event_id, title, description, banner, status, start_date, end_date, free_vote_window_hours, premium_vote_packs)
VALUES
('vc-demo-1', 'org-1', 'Overcom Production', NULL, 'Meilleur Artiste Ivoirien 2026',
 'Votez pour votre artiste préféré parmi les nommés de l''année ! Un vote gratuit par jour, ou boostez votre favori avec des voix premium.',
 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&auto=format&fit=crop&q=60',
 'active', now() - interval '2 days', now() + interval '30 days', 24,
 '[{"votes":10,"price":1000},{"votes":50,"price":4000},{"votes":100,"price":7000}]'),
('vc-demo-2', 'org-1', 'Overcom Production', 'evt-1', 'Prix du Public — Concert Didi B',
 'Élisez la meilleure prestation de la soirée à l''Agora d''Abobo.',
 'https://images.unsplash.com/photo-1470229538611-16ba8c7ffbd7?w=800&auto=format&fit=crop&q=60',
 'active', now() - interval '1 day', now() + interval '14 days', 24,
 '[{"votes":5,"price":500},{"votes":20,"price":1500}]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.candidates (id, campaign_id, name, photo, description, display_order)
VALUES
('cand-demo-1-1', 'vc-demo-1', 'Didi B', 'https://images.unsplash.com/photo-1516280440614-37939bbacd6a?w=400&auto=format&fit=crop&q=60', 'Le Shogun du rap ivoirien.', 0),
('cand-demo-1-2', 'vc-demo-1', 'Suspect96', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=60', 'Star montante de la scène urbaine.', 1),
('cand-demo-1-3', 'vc-demo-1', 'Serge Beynaud', 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400&auto=format&fit=crop&q=60', 'Le roi du Coupé-Décalé.', 2),
('cand-demo-1-4', 'vc-demo-1', 'Josey', 'https://images.unsplash.com/photo-1521119989659-a83eee488004?w=400&auto=format&fit=crop&q=60', 'Voix emblématique de la musique ivoirienne.', 3),
('cand-demo-2-1', 'vc-demo-2', 'Première partie', NULL, 'Ouverture de la soirée.', 0),
('cand-demo-2-2', 'vc-demo-2', 'Deuxième partie', NULL, 'Clôture de la soirée.', 1)
ON CONFLICT (id) DO NOTHING;
