# 🤖 CLAUDE CODE — Security Runbook · Clicbillet-2
> **Instructions for Claude Code** : Ce fichier est un runbook auto-exécutable.
> Lis-le intégralement, puis exécute chaque étape dans l'ordre sans demander de confirmation,
> sauf indication explicite `[PAUSE — attendre validation humaine]`.
> Objectif final : application **totalement fonctionnelle ET sécurisée**, prête pour la production.

---

## 🗺️ LOOP D'EXÉCUTION

```
START
  │
  ▼
[PHASE 0] Audit & cartographie du code existant
  │
  ▼
[PHASE 1] Sécurisation des variables d'environnement
  │
  ▼
[PHASE 2] Supabase — RLS + migrations SQL
  │
  ▼
[PHASE 3] Express — middleware de sécurité complet
  │
  ▼
[PHASE 4] Paiement PaiementPro — webhook sécurisé
  │
  ▼
[PHASE 5] Frontend React/Vite — durcissement
  │
  ▼
[PHASE 6] Cache — stratégie complète
  │
  ▼
[PHASE 7] vercel.json — headers + cache HTTP
  │
  ▼
[PHASE 8] Tests de non-régression fonctionnelle
  │
  ▼
[PHASE 9] Vérification finale & rapport
  │
  ▼
END → commit "security: hardening complet clicbillet-2"
```

---

## ⚙️ PHASE 0 — Audit initial (exécution automatique)

**Claude Code doit :**

```bash
# 1. Lister la structure complète du projet
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.json" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" | sort

# 2. Détecter les fuites potentielles de secrets
grep -rn "VITE_" . --include="*.ts" --include="*.tsx" --include="*.js" \
  ! -path "*/node_modules/*" | grep -v "SUPABASE_URL\|SUPABASE_ANON_KEY"

# 3. Repérer les appels fetch/axios côté client vers l'API
grep -rn "fetch\|axios" src/ --include="*.ts" --include="*.tsx"

# 4. Lister les packages installés
cat package.json | grep -A 50 '"dependencies"'
```

> Consigner les résultats dans un objet mental `AUDIT_RESULTS` pour guider les phases suivantes.

---

## 🔑 PHASE 1 — Variables d'environnement

### 1.1 — Fichier `.env.example` (créer ou mettre à jour)

```bash
# Claude Code : créer/remplacer .env.example avec exactement ce contenu
```

**Fichier `.env.example` :**
```env
# ─── PUBLIC (exposées au client via Vite) ────────────────────────
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# ─── SERVEUR UNIQUEMENT (jamais de préfixe VITE_) ────────────────
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PAIEMENTPRO_API_KEY=pp_live_...
PAIEMENTPRO_WEBHOOK_SECRET=whsec_...
JWT_SECRET=une_chaine_aleatoire_256bits
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://clicbillet-2.vercel.app
```

### 1.2 — Vérification .gitignore

```bash
# Claude Code : s'assurer que ces lignes existent dans .gitignore
```

**Lignes à garantir dans `.gitignore` :**
```
.env
.env.local
.env.production
.env.*.local
*.pem
```

### 1.3 — Audit automatique des secrets exposés

**Claude Code doit créer `scripts/check-env-safety.ts` :**
```typescript
// scripts/check-env-safety.ts
// Exécuté en pre-build : bloque si une clé sensible est préfixée VITE_
const FORBIDDEN_VITE_KEYS = [
  'VITE_SUPABASE_SERVICE_ROLE',
  'VITE_PAIEMENTPRO',
  'VITE_JWT_SECRET',
];

let hasFatal = false;
for (const key of FORBIDDEN_VITE_KEYS) {
  if (process.env[key]) {
    console.error(`❌ FATAL: ${key} ne doit PAS être une variable VITE_`);
    hasFatal = true;
  }
}
if (hasFatal) process.exit(1);
console.log('✅ Variables d\'environnement : OK');
```

**Ajouter dans `package.json` :**
```json
"scripts": {
  "prebuild": "tsx scripts/check-env-safety.ts",
  ...
}
```

---

## 🗄️ PHASE 2 — Supabase RLS & Migrations

### 2.1 — Structure des migrations

**Claude Code doit créer `supabase/migrations/001_security_rls.sql` :**

```sql
-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 001 : Activation RLS + Policies Clicbillet-2
-- ═══════════════════════════════════════════════════════════════

-- ── Table : events (publique en lecture, admin en écriture) ────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_select_public"
  ON events FOR SELECT USING (true);

CREATE POLICY "events_insert_admin"
  ON events FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "events_update_admin"
  ON events FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── Table : tickets (propriétaire uniquement) ──────────────────
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tickets_select_own"
  ON tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "tickets_insert_own"
  ON tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── Table : orders (propriétaire uniquement) ──────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select_own"
  ON orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "orders_insert_own"
  ON orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── Table : profiles (propriétaire uniquement) ─────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ── Vérification finale ─────────────────────────────────────────
-- Claude Code : exécuter cette requête pour confirmer
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public';
-- Toutes les tables doivent avoir rowsecurity = true
```

### 2.2 — Client Supabase sécurisé côté frontend

**Claude Code doit créer/remplacer `src/lib/supabase.ts` :**

```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variables Supabase manquantes. Vérifier .env');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Stockage sécurisé : localStorage uniquement pour le token de session
    // (pas les données métier)
    storage: window.localStorage,
  },
  global: {
    headers: {
      'x-application-name': 'clicbillet-2',
    },
  },
});

// Client admin (côté serveur Express uniquement — NE PAS IMPORTER DANS REACT)
// export const supabaseAdmin = createClient<Database>(
//   process.env.SUPABASE_URL!,
//   process.env.SUPABASE_SERVICE_ROLE_KEY!
// );
```

### 2.3 — Client admin serveur

**Claude Code doit créer `server/lib/supabaseAdmin.ts` :**

```typescript
// server/lib/supabaseAdmin.ts — SERVEUR UNIQUEMENT
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Variables Supabase admin manquantes côté serveur');
}

export const supabaseAdmin = createClient<Database>(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
```

---

## ⚙️ PHASE 3 — Express : Middleware de sécurité complet

**Claude Code doit installer les packages manquants :**

```bash
npm install helmet express-rate-limit cors express-validator compression \
            cookie-parser hpp express-mongo-sanitize
npm install -D @types/cors @types/compression @types/cookie-parser
```

**Claude Code doit créer/remplacer `server/middleware/security.ts` :**

```typescript
// server/middleware/security.ts
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import hpp from 'hpp';
import { Request, Response, NextFunction } from 'express';

// ── CORS ────────────────────────────────────────────────────────
export const corsMiddleware = cors({
  origin: process.env.CORS_ORIGIN ?? 'https://clicbillet-2.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // 24h preflight cache
});

// ── HELMET (security headers côté API) ─────────────────────────
export const helmetMiddleware = helmet({
  contentSecurityPolicy: false, // Géré par vercel.json côté frontend
  crossOriginEmbedderPolicy: true,
});

// ── RATE LIMITERS ───────────────────────────────────────────────
const makeRateLimiter = (max: number, windowMs = 60_000) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ error: 'Trop de requêtes. Réessayez dans un moment.' });
    },
  });

export const rateLimiters = {
  auth:     makeRateLimiter(5),          // 5 req/min — login, register
  payments: makeRateLimiter(10),         // 10 req/min — paiements
  tickets:  makeRateLimiter(20),         // 20 req/min — achat billets
  general:  makeRateLimiter(100),        // 100 req/min — routes publiques
};

// ── PROTECTION HPP (HTTP Parameter Pollution) ──────────────────
export const hppMiddleware = hpp();

// ── JWT VERIFY MIDDLEWARE ───────────────────────────────────────
import jwt from 'jsonwebtoken';

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};

// ── SANITISATION DES INPUTS ─────────────────────────────────────
export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  // Supprimer les clés commençant par $ ou contenant des points (injection NoSQL)
  const sanitize = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) return obj;
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => !k.startsWith('$') && !k.includes('.'))
        .map(([k, v]) => [k, sanitize(v)])
    );
  };
  req.body = sanitize(req.body);
  next();
};

// ── LOGGER SÉCURISÉ (masque les données sensibles) ─────────────
export const safeLogger = (req: Request, _res: Response, next: NextFunction) => {
  const sensitive = ['password', 'token', 'secret', 'card', 'cvv', 'pan'];
  const body = { ...req.body };
  sensitive.forEach(k => { if (body[k]) body[k] = '***'; });
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, body);
  next();
};
```

**Claude Code doit mettre à jour `server/index.ts` pour appliquer tous les middlewares :**

```typescript
// server/index.ts (sections à intégrer dans l'ordre)
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import {
  corsMiddleware, helmetMiddleware, rateLimiters,
  hppMiddleware, sanitizeInput, safeLogger
} from './middleware/security';

const app = express();

// Ordre critique des middlewares :
app.set('trust proxy', 1);              // Pour rate-limit derrière Vercel
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.options('*', corsMiddleware);       // Preflight
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10kb' })); // Limite la taille des payloads
app.use(hppMiddleware);
app.use(sanitizeInput);
app.use(safeLogger);

// Rate limiters par route
app.use('/api/auth',     rateLimiters.auth);
app.use('/api/payments', rateLimiters.payments);
app.use('/api/tickets',  rateLimiters.tickets);
app.use('/api',          rateLimiters.general);

// ... routes existantes ...
```

---

## 💳 PHASE 4 — PaiementPro : Webhook sécurisé

**Claude Code doit créer/remplacer `server/routes/payments.ts` :**

```typescript
// server/routes/payments.ts
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { requireAuth } from '../middleware/security';

const router = Router();

// ── CRÉATION D'UNE INTENTION DE PAIEMENT ───────────────────────
// Le montant est TOUJOURS recalculé côté serveur
router.post('/create-intent', requireAuth, async (req: Request, res: Response) => {
  try {
    const { eventId, quantity } = req.body;
    const userId = (req as any).user.sub;

    // 1. Récupérer le prix réel depuis la base (jamais du client)
    const { data: event, error } = await supabaseAdmin
      .from('events')
      .select('id, price, available_seats, title')
      .eq('id', eventId)
      .single();

    if (error || !event) return res.status(404).json({ error: 'Événement introuvable' });
    if (event.available_seats < quantity) return res.status(400).json({ error: 'Places insuffisantes' });

    // 2. Calculer le montant côté serveur
    const amount = event.price * quantity;

    // 3. Créer la commande en statut PENDING
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: userId,
        event_id: eventId,
        quantity,
        amount,
        status: 'pending',
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // 4. Appeler l'API PaiementPro avec le montant serveur
    const ppResponse = await fetch('https://api.paiementpro.net/v1/payment/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PAIEMENTPRO_API_KEY}`,
      },
      body: JSON.stringify({
        amount,
        currency: 'XOF',
        order_id: order.id,
        return_url: `${process.env.CORS_ORIGIN}/payment/success`,
        cancel_url:  `${process.env.CORS_ORIGIN}/payment/cancel`,
        notify_url:  `${process.env.CORS_ORIGIN}/api/payments/webhook`,
      }),
    });

    const ppData = await ppResponse.json();
    if (!ppResponse.ok) throw new Error(ppData.message ?? 'Erreur PaiementPro');

    return res.json({ paymentUrl: ppData.payment_url, orderId: order.id });
  } catch (err) {
    console.error('[payments/create-intent]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// ── WEBHOOK PaiementPro (signature HMAC obligatoire) ────────────
// ⚠️ Cette route doit recevoir le body RAW (avant json parser)
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }), // body brut pour HMAC
  async (req: Request, res: Response) => {
    const signature = req.headers['x-paiementpro-signature'] as string;
    const rawBody   = req.body as Buffer;

    // 1. Vérifier la signature HMAC-SHA256
    const expected = crypto
      .createHmac('sha256', process.env.PAIEMENTPRO_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');

    if (!signature || signature !== expected) {
      console.warn('[webhook] Signature invalide');
      return res.status(401).json({ error: 'Signature invalide' });
    }

    // 2. Parser le body validé
    let event: any;
    try {
      event = JSON.parse(rawBody.toString());
    } catch {
      return res.status(400).json({ error: 'Body invalide' });
    }

    // 3. Traiter les événements de paiement
    if (event.type === 'payment.success') {
      const { order_id, transaction_id } = event.data;

      const { error } = await supabaseAdmin
        .from('orders')
        .update({ status: 'confirmed', transaction_id })
        .eq('id', order_id)
        .eq('status', 'pending'); // idempotence : ne confirme que si pending

      if (error) console.error('[webhook] Mise à jour commande échouée', error);
      else {
        // Générer les billets uniquement après confirmation
        await generateTickets(order_id);
      }
    }

    if (event.type === 'payment.failed') {
      await supabaseAdmin
        .from('orders')
        .update({ status: 'failed' })
        .eq('id', event.data.order_id);
    }

    // Toujours renvoyer 200 pour éviter les retries infinis
    return res.status(200).json({ received: true });
  }
);

async function generateTickets(orderId: string) {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('*, events(*)')
    .eq('id', orderId)
    .single();

  if (!order) return;

  const tickets = Array.from({ length: order.quantity }, () => ({
    order_id:  orderId,
    user_id:   order.user_id,
    event_id:  order.event_id,
    qr_code:   crypto.randomUUID(),
    status:    'valid',
  }));

  await supabaseAdmin.from('tickets').insert(tickets);
  await supabaseAdmin
    .from('events')
    .update({ available_seats: order.events.available_seats - order.quantity })
    .eq('id', order.event_id);
}

export default router;
```

---

## 🖥️ PHASE 5 — Frontend : Durcissement React/Vite

### 5.1 — vite.config.ts sécurisé

**Claude Code doit mettre à jour `vite.config.ts` :**

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    sourcemap: false,           // ← Désactivé en production
    rollupOptions: {
      output: {
        // Chunking pour éviter d'exposer la structure interne
        manualChunks: {
          vendor: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
    // Minification agressive
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: mode === 'production', // Supprimer console.log en prod
        drop_debugger: true,
      },
    },
  },
  server: {
    headers: {
      'X-Content-Type-Options': 'nosniff',
    },
  },
}));
```

### 5.2 — Gestion sécurisée des erreurs côté React

**Claude Code doit créer `src/components/ErrorBoundary.tsx` :**

```tsx
// src/components/ErrorBoundary.tsx
import React, { Component, ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Logger l'erreur côté serveur sans exposer au client
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        // Ne pas envoyer la stack complète en prod
        stack: import.meta.env.DEV ? error.stack : undefined,
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Une erreur est survenue.</h2>
          <p>Veuillez rafraîchir la page ou contacter le support.</p>
          <button onClick={() => window.location.reload()}>Rafraîchir</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**Claude Code doit envelopper `<App />` dans `src/main.tsx` :**
```tsx
<ErrorBoundary>
  <App />
</ErrorBoundary>
```

---

## 💾 PHASE 6 — Cache : Stratégie complète

### 6.1 — Cache HTTP côté Express

**Claude Code doit créer `server/middleware/cache.ts` :**

```typescript
// server/middleware/cache.ts
import { Request, Response, NextFunction } from 'express';
import NodeCache from 'node-cache';

// Cache in-memory (remplacer par Redis en production multi-instance)
export const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// ── Middleware de cache par route ───────────────────────────────
export function cacheMiddleware(ttlSeconds = 60) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Ne pas cacher les requêtes authentifiées
    if (req.headers.authorization) return next();

    const key = `cache:${req.method}:${req.originalUrl}`;
    const cached = cache.get(key);

    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    // Intercepter la réponse pour la cacher
    const originalJson = res.json.bind(res);
    res.json = (data: any) => {
      if (res.statusCode === 200) {
        cache.set(key, data, ttlSeconds);
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(data);
    };

    next();
  };
}

// ── Invalidation du cache ───────────────────────────────────────
export function invalidateCache(pattern: string) {
  const keys = cache.keys().filter(k => k.includes(pattern));
  keys.forEach(k => cache.del(k));
  console.log(`[cache] Invalidé ${keys.length} clés pour pattern "${pattern}"`);
}
```

**Installer le package :**
```bash
npm install node-cache
npm install -D @types/node-cache
```

**Appliquer le cache sur les routes publiques dans `server/index.ts` :**
```typescript
import { cacheMiddleware } from './middleware/cache';

// Events publics : cache 5 minutes
app.get('/api/events',        cacheMiddleware(300));
app.get('/api/events/:id',    cacheMiddleware(120));
```

### 6.2 — Cache HTTP headers (vercel.json)

Les assets statiques Vite ont des hashes dans leur nom → cache agressif possible.

```json
// Dans vercel.json (voir Phase 7) :
// Assets Vite (JS/CSS hashés) : 1 an
{ "source": "/assets/(.*)", "headers": [
  { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
]},
// Pages HTML : pas de cache (pour les mises à jour immédiates)
{ "source": "/(.*).html", "headers": [
  { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
]},
// API : pas de cache navigateur
{ "source": "/api/(.*)", "headers": [
  { "key": "Cache-Control", "value": "no-store" }
]}
```

### 6.3 — Cache côté React (SWR / React Query)

**Claude Code doit créer `src/hooks/useEvents.ts` :**

```typescript
// src/hooks/useEvents.ts — Cache côté client avec invalidation propre
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,   // Considéré frais pendant 5 min
    gcTime:    10 * 60 * 1000,  // Gardé en mémoire 10 min
    refetchOnWindowFocus: false, // Pas de refetch intempestif
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: ['events', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!id,
  });
}

// Hook pour invalider le cache après achat
export function useInvalidateEvents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['events'] });
}
```

**Installer React Query si absent :**
```bash
npm install @tanstack/react-query
```

**Configurer dans `src/main.tsx` :**
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

// Envelopper <App /> :
<QueryClientProvider client={queryClient}>
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
</QueryClientProvider>
```

---

## 🛡️ PHASE 7 — vercel.json : Headers + Cache + Routing

**Claude Code doit créer/remplacer `vercel.json` à la racine du projet :**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/server/index.ts" },
    { "source": "/((?!api).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options",           "value": "DENY" },
        { "key": "X-Content-Type-Options",    "value": "nosniff" },
        { "key": "X-XSS-Protection",          "value": "1; mode=block" },
        { "key": "Referrer-Policy",           "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy",        "value": "camera=(), microphone=(), geolocation=(), payment=(self)" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.paiementpro.net; frame-ancestors 'none';"
        }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
      ]
    },
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

---

## 🧪 PHASE 8 — Tests de non-régression fonctionnelle

**Claude Code doit créer `scripts/smoke-test.ts` et l'exécuter :**

```typescript
// scripts/smoke-test.ts
// Test de fumée post-déploiement : vérifie que l'app reste fonctionnelle

const BASE_URL = process.env.TEST_URL ?? 'https://clicbillet-2.vercel.app';

interface TestResult { name: string; ok: boolean; detail?: string; }
const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    results.push({ name, ok: false, detail: e.message });
    console.error(`  ❌ ${name} — ${e.message}`);
  }
}

async function run() {
  console.log(`\n🧪 Smoke tests — ${BASE_URL}\n`);

  // ── Disponibilité ─────────────────────────────────────────────
  await test('App accessible (200)', async () => {
    const r = await fetch(BASE_URL);
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
  });

  // ── Security Headers ─────────────────────────────────────────
  await test('X-Frame-Options présent', async () => {
    const r = await fetch(BASE_URL);
    if (!r.headers.get('x-frame-options')) throw new Error('Header manquant');
  });

  await test('Content-Security-Policy présent', async () => {
    const r = await fetch(BASE_URL);
    if (!r.headers.get('content-security-policy')) throw new Error('CSP manquant');
  });

  await test('HSTS présent', async () => {
    const r = await fetch(BASE_URL);
    if (!r.headers.get('strict-transport-security')) throw new Error('HSTS manquant');
  });

  // ── API ──────────────────────────────────────────────────────
  await test('GET /api/events accessible', async () => {
    const r = await fetch(`${BASE_URL}/api/events`);
    if (![200, 304].includes(r.status)) throw new Error(`Status ${r.status}`);
  });

  await test('POST /api/payments sans auth → 401', async () => {
    const r = await fetch(`${BASE_URL}/api/payments/create-intent`, { method: 'POST' });
    if (r.status !== 401) throw new Error(`Attendu 401, reçu ${r.status}`);
  });

  await test('Route inexistante → 404', async () => {
    const r = await fetch(`${BASE_URL}/api/inexistant`);
    if (r.status !== 404) throw new Error(`Attendu 404, reçu ${r.status}`);
  });

  // ── Cache ────────────────────────────────────────────────────
  await test('Assets statiques avec Cache-Control long', async () => {
    const r = await fetch(`${BASE_URL}/`);
    const text = await r.text();
    const assetMatch = text.match(/\/assets\/[^"']+\.js/);
    if (!assetMatch) throw new Error('Aucun asset JS trouvé');
    const assetRes = await fetch(`${BASE_URL}${assetMatch[0]}`);
    const cc = assetRes.headers.get('cache-control') ?? '';
    if (!cc.includes('max-age=31536000')) throw new Error(`Cache-Control insuffisant: ${cc}`);
  });

  // ── Résumé ───────────────────────────────────────────────────
  const failed = results.filter(r => !r.ok);
  console.log(`\n📊 Résultat : ${results.length - failed.length}/${results.length} OK`);
  if (failed.length > 0) {
    console.error('\n❌ Tests en échec :');
    failed.forEach(f => console.error(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  } else {
    console.log('\n✅ Tous les tests passent — déploiement validé.\n');
  }
}

run();
```

**Ajouter dans `package.json` :**
```json
"scripts": {
  "test:smoke": "tsx scripts/smoke-test.ts",
  "test:smoke:prod": "TEST_URL=https://clicbillet-2.vercel.app tsx scripts/smoke-test.ts"
}
```

---

## 📋 PHASE 9 — Vérification finale & Rapport

**Claude Code doit exécuter dans l'ordre :**

```bash
# 1. Vérification des secrets
npm run prebuild

# 2. Build de production (doit réussir sans erreur)
npm run build

# 3. Smoke tests en local (si preview disponible)
npm run preview &
sleep 3
TEST_URL=http://localhost:4173 npm run test:smoke

# 4. Vérifier qu'aucun secret n'est dans le bundle
grep -r "service_role\|PAIEMENTPRO_API_KEY\|JWT_SECRET" dist/ && echo "❌ SECRET EXPOSÉ" || echo "✅ Pas de secret dans le bundle"

# 5. Taille du bundle
du -sh dist/assets/*.js | sort -hr | head -10
```

**Claude Code doit ensuite faire un commit unique :**
```bash
git add -A
git commit -m "security: hardening complet clicbillet-2

- RLS Supabase activé sur toutes les tables (events, tickets, orders, profiles)
- Middleware Express : CORS, rate-limit, HPP, sanitisation, JWT verify
- Webhook PaiementPro avec vérification HMAC-SHA256
- Montants recalculés côté serveur uniquement
- Security headers complets dans vercel.json (CSP, HSTS, X-Frame-Options...)
- Cache stratégique : assets 1 an, HTML no-cache, API no-store
- React Query pour le cache client avec invalidation propre
- Source maps désactivées en production
- ErrorBoundary sans fuite de stack traces
- Script check-env-safety en pre-build
- Smoke tests de non-régression"

git push origin main
```

---

## 📊 Tableau de bord final

| Phase | Contrôle | Priorité | Statut Claude Code |
|-------|----------|----------|--------------------|
| 1 | Clés privées hors `VITE_` + pre-build check | 🔴 Critique | À implémenter |
| 2 | RLS Supabase + migrations SQL | 🔴 Critique | À implémenter |
| 3 | Express : CORS, rate-limit, JWT, sanitisation | 🔴 Critique | À implémenter |
| 4 | Webhook PaiementPro HMAC + logique serveur | 🔴 Critique | À implémenter |
| 5 | Vite : sourcemap off, minification, ErrorBoundary | 🟠 Haute | À implémenter |
| 6 | Cache : node-cache + React Query + Cache-Control | 🟠 Haute | À implémenter |
| 7 | vercel.json : headers + cache headers | 🟠 Haute | À implémenter |
| 8 | Smoke tests fonctionnels | 🟡 Moyenne | À implémenter |
| 9 | Build propre + commit unique | 🟡 Moyenne | À implémenter |

---

## 🚦 Règles d'exécution pour Claude Code

1. **Ne jamais demander confirmation** sauf `[PAUSE]` explicite
2. **Lire le code existant avant de modifier** — adapter au style en place
3. **Ne pas casser les fonctionnalités existantes** — smoke test obligatoire
4. **Si un package est déjà installé**, ne pas réinstaller
5. **Si une route existe déjà**, fusionner (ne pas dupliquer)
6. **En cas d'erreur de build**, corriger avant de passer à la phase suivante
7. **Résultat attendu** : `npm run build` réussit + smoke tests verts + commit poussé

---

*Runbook généré le 22/06/2026 · Stack : React/TS · Vite · Express · Supabase · PaiementPro · Vercel*
