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
