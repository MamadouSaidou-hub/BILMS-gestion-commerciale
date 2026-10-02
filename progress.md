# Progrès — BILMS Management System

## 0. Origine

Ce projet est un fork du système de gestion commerciale BGM (Barry-Gate Multi Service), adapté pour BILMS (vente de savon). Le code applicatif, l'architecture (Next.js 16 + Drizzle ORM + Postgres/Supabase + better-auth) et les fonctionnalités métier (ventes, stock, transferts, trésorerie, remises par palier, rapports, facture) sont identiques — seuls le branding (`lib/company-info.ts`), le vocabulaire d'unité (`lib/business-config.ts`) et le catalogue de démo (`lib/db/seed.ts`) ont été adaptés.

**Base/déploiement entièrement séparés de BGM** : nouveau projet Supabase, nouveau projet Vercel, pas de partage de données entre les deux.

## 1. État au moment du fork

- Code généralisé (voir commit "Generalize unit vocabulary and branding before forking" dans l'historique) : plus aucun texte "Sac"/"Tonne"/"BGM" codé en dur, tout passe par `businessConfig`/`companyInfo`.
- `lib/business-config.ts` configuré pour BILMS : unité de base "Pièce", unité groupée "Carton". Contrairement à la farine (conversion par poids, un ratio physique universel), le nombre de pièces par carton varie selon le produit — c'est pourquoi `bulkConversionFactor` reste à `1` et chaque produit porte sa propre valeur dans le champ `sackWeightKg` (nom de colonne hérité de BGM, non renommé — voir le commentaire dans `business-config.ts`).
- `lib/db/seed.ts` contient un catalogue de démo **générique** (4 types de savon, prix/quantités fictifs) — à remplacer par le vrai catalogue du client avant mise en production.
- Logo **pas encore fourni** — `companyInfo.logoPath` pointe vers `/logo-bilms.jpeg`, qui n'existe pas encore dans `public/`. Pareil pour `app/icon.jpeg`/`app/apple-icon.jpeg` (favicon). Tant que ces fichiers ne sont pas ajoutés, l'app fonctionne normalement mais affiche une icône cassée à la place du logo.

## 2. Reste à faire avant mise en production

1. Créer le projet Supabase (voir README section 3 pour le format de connexion — utiliser le **pooler**, pas la connexion directe), renseigner `DATABASE_URL` dans `.env.local`.
2. `pnpm db:push` puis `pnpm db:seed` (catalogue démo) et `pnpm db:seed-admin` (compte admin démo).
3. Remplacer le catalogue de démo par les vrais produits/prix du client dans `lib/db/seed.ts`, puis re-seed.
4. Ajouter le logo réel (`public/logo-bilms.jpeg`, `app/icon.jpeg`, `app/apple-icon.jpeg`).
5. Compléter `lib/company-info.ts` (slogan, adresse) si besoin — actuellement générique.
6. Créer le dépôt GitHub, le projet Vercel, déployer, configurer `BETTER_AUTH_URL`/`DATABASE_URL`/`BETTER_AUTH_SECRET` (secret différent de celui de BGM).
7. Créer le vrai compte admin du client via `/utilisateurs` une fois connecté avec le compte de démo, puis envisager de retirer le compte de démo.
