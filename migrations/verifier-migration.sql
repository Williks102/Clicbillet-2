-- Vérification de la migration ClicBillet. Aucune écriture, lecture seule.
WITH attendu(categorie, objet, present) AS (
  SELECT 'Fonction', f, EXISTS (SELECT 1 FROM pg_proc WHERE proname = f)
    FROM unnest(ARRAY['rate_limit_check','reserve_tickets','release_tickets',
                      'advance_waiting_room','waiting_room_gate','slugify_category']) f
  UNION ALL
  SELECT 'Table', t, EXISTS (SELECT 1 FROM information_schema.tables
                              WHERE table_schema='public' AND table_name = t)
    FROM unnest(ARRAY['rate_limit_hits','event_pressure','categories','scan_conflicts']) t
  UNION ALL
  SELECT 'Colonne', 'events.' || c, EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_name='events' AND column_name = c)
    FROM unnest(ARRAY['tier_sold','scheduled_onsale','category_slug']) c
  UNION ALL
  SELECT 'Colonne', 'tickets.' || c, EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_name='tickets' AND column_name = c)
    FROM unnest(ARRAY['scanned_device','scan_source']) c
  UNION ALL
  SELECT 'Vue publique', 'events_public.' || c, EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_name='events_public' AND column_name = c)
    FROM unnest(ARRAY['category_slug','scheduled_onsale']) c
  UNION ALL
  SELECT 'Réglage', k, EXISTS (SELECT 1 FROM public.platform_config WHERE key = k)
    FROM unnest(ARRAY['waiting_room_threshold','waiting_room_capacity',
                      'waiting_room_active_minutes','waiting_room_window_seconds']) k
  UNION ALL
  SELECT 'Intégrité', 'events_category_slug_fkey',
         EXISTS (SELECT 1 FROM pg_constraint WHERE conname='events_category_slug_fkey')
)
SELECT CASE WHEN present THEN '✅' ELSE '❌ MANQUANT' END AS etat, categorie, objet
FROM attendu ORDER BY present, categorie, objet;
