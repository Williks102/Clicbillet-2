-- Habillage du pass par l'organisateur — section 29 de supabase_setup.sql, extraite ici pour
-- être jouée seule sur une base existante.
--
-- À exécuter dans l'éditeur SQL de Supabase. Rejouable sans risque : ADD COLUMN IF NOT EXISTS
-- ne touche pas une colonne déjà présente, et aucune ligne existante n'est réécrite (un
-- pass_design NULL est traité comme « thème par défaut » par le serveur).

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS pass_design JSONB;

-- Vérification : doit renvoyer une ligne (jsonb).
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'pass_design';
