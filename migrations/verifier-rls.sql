-- Vérification de la posture RLS en PRODUCTION
-- ============================================
-- L'audit de sécurité porte sur supabase_setup.sql (la source de vérité). L'état réel de la
-- base peut diverger : une policy désactivée depuis le tableau de bord, un script joué
-- partiellement, une table ajoutée à la main. Jouer ces trois requêtes dans l'éditeur SQL
-- Supabase (rôle postgres) confirme que la prod correspond au fichier. Lecture seule.

-- 1. TOUTE table publique doit avoir rowsecurity = true. Une seule ligne « false » = un trou :
--    la clé anon peut lire/écrire cette table directement, en contournant le code serveur.
SELECT tablename, rowsecurity AS rls_active
  FROM pg_tables
 WHERE schemaname = 'public'
 ORDER BY rowsecurity, tablename;

-- 2. Liste toutes les policies et à qui elles s'appliquent. À contrôler :
--    - aucune policy en INSERT/UPDATE/DELETE pour {anon, authenticated} (toute écriture doit
--      passer par le backend en service_role) ;
--    - aucune clause « qual » ou « with_check » valant 'true' pour anon/authenticated ;
--    - les seules policies attendues pour anon/authenticated sont des SELECT :
--      events (status='approved'), tickets (buyer_id = auth.uid()), categories/vendor_categories (active).
SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, cmd, policyname;

-- 3. Les tables sensibles ne doivent PORTER AUCUNE policy pour anon/authenticated
--    (donc RLS active + 0 policy = refus total pour ces rôles, seul service_role accède).
--    Cette requête doit renvoyer 0 ligne.
SELECT c.relname AS table_sensible, p.policyname, p.roles
  FROM pg_policies p
  JOIN pg_class c ON c.relname = p.tablename
 WHERE p.schemaname = 'public'
   AND p.tablename IN ('users','payouts','transactions','password_resets',
                       'platform_config','organizer_requests','ticket_transfers',
                       'email_outbox','vendor_leads','scan_conflicts')
   AND (p.roles && ARRAY['anon','authenticated']::name[]);

-- 4. Rappel : la clé service_role contourne la RLS par conception. Elle ne doit JAMAIS être
--    exposée au navigateur (vérifié au build par scripts/check-build-secrets.mjs) — seul le
--    backend l'utilise. Vérifiez côté hébergeur qu'elle n'est pas dans une variable VITE_*.
