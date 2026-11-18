# Rapport d'audit croisé — Tickekette

**Auditeur :** cokoumouna@gmail.com
**Date :** 2026-10-06
**Cible :** projet Tickekette (billetterie multi-collectifs) — autre groupe
**Périmètre :** code serveur (`server/`) et client (`client/`), base SQLite, flux paiement/webhook, contrôle d'accès.

> Audit **autorisé** dans le cadre d'un TP d'audit croisé. Les tests dynamiques n'ont visé qu'une instance locale (`http://localhost:3001`) semée avec des données de démo. Aucun système tiers n'a été touché.

---

## 1. Méthodologie

1. **Revue de code statique manuelle** de tout le serveur (auth, middleware sécurité, routes, services métier, schéma) et recherche de sinks XSS côté client.
2. **Exécution de la suite de tests** du projet (serveur + client), lint et typecheck.
3. **Pentest dynamique** contre une instance en fonctionnement : contrôle d'accès, IDOR, CSRF, falsification de jeton, recalcul de prix, signature de webhook, survente concurrente, divulgation de données (`pentest.mjs`).
4. **Attaques de logique métier** (mentalité attaquant) : forge de notification de paiement, double-paiement concurrent, montants falsifiés (dont négatifs), pollution de prototype, paiement tardif sur commande annulée (`pentest-avance.mjs`).

L'analyseur statique à base de motifs (ancien contenu de ce fichier) a produit des **faux positifs** : les « injections SQL » signalées sont des clés de cache React (`useApiQuery('orders:${eventId}')`) et des noms de table **constants** internes (`db.js`, `seed.js`), jamais des entrées utilisateur. Tout l'accès base passe par des requêtes préparées à paramètres liés (`get/all/run` dans `db.js`). **Aucune injection SQL n'est exploitable.**

---

## 2. Résultat des tests

| Vérification | Résultat |
|---|---|
| Tests serveur (`node --test`) | **55 / 55** ✅ |
| Tests client (`vitest`) | **82 / 82** ✅ |
| Lint (`eslint .`) | **0 erreur** ✅ |
| Typecheck serveur (`tsc`) | **0 erreur** ✅ |

La suite de tests est remarquable : elle couvre explicitement la survente concurrente (50 et 200 achats simultanés), la double notification de paiement, la falsification de QR code, l'isolation inter-collectifs, la falsification de JWT, et la configuration de production.

---

## 3. Synthèse

Le projet est **exceptionnellement bien sécurisé**. La quasi-totalité des défenses attendues sont présentes, correctes, et validées dynamiquement. **Aucune faille exploitable en production n'a été trouvée.** Les deux failles réellement exploitables (**F1** et **F6**) partagent la même cause racine — en **mode non-production**, des points d'entrée puissants ne sont protégés que par un **secret public/codé en dur** ou par **aucune authentification** — et la configuration bloque durement ce mode en production.

| # | Faille | Gravité | Exploitable en prod ? |
|---|---|---|---|
| **F6** | **Forge de notification de paiement** avec le secret de webhook de dev (public) → billets payés émis **sans aucun paiement** | **Élevée** (en mode non-prod) | Non (secret fort/inconnu imposé en prod) |
| **F1** | Outils de démo (`/api/dev/*`) sans authentification → fuite des liens secrets de commande + manipulation de l'horloge | **Moyenne** (Élevée si instance non-prod exposée) | Non (désactivés en prod par `config.js`) |
| **F2** | Identifiants de démo faibles et connus (`demo1234`) semés automatiquement | Faible | Non (seed bloqué en prod) |
| **F3** | `trustProxy` par défaut à 0 → rate-limiting inopérant/contournable derrière un proxy mal configuré | Faible (durcissement déploiement) | Oui, si mal déployé |
| **F4** | Horodatage de scan fourni par le client accepté (±24 h) | Information | — |
| **F5** | Commentaire du schéma incohérent avec la contrainte réelle | Cosmétique | — |

---

## 4. Détail des failles

### F6 — Forge de notification de paiement (billets gratuits) — Gravité : ÉLEVÉE (mode non-prod)

**Où :** `server/src/routes/payments.js` (`webhookRouter`), monté dans `app.js` via `app.use('/api/webhooks', webhookRouter)` — **avant** `express.json` et `requireCsrfHeader`.

**Problème :** le webhook `/api/webhooks/payment` est monté dans **tous** les environnements, sans authentification par session et sans en-tête anti-CSRF (c'est normal : le prestataire n'a pas de session). Sa **seule** protection est la signature HMAC vérifiée avec `config.webhookSecret`. Or en dehors de la production, ce secret vaut la valeur **codée en dur et publique** du dépôt (`config.js` → `DEV_SECRETS.WEBHOOK_SECRET = 'dev-only-webhook-secret-not-for-production-use'`). N'importe qui connaissant le code (c'est-à-dire tout le monde) peut donc **forger une notification valablement signée**.

**Exploitation vérifiée** (instance locale, sans authentification, sans passer par le prestataire) :

```
1. POST /api/events/3/orders {card, 1×Standard}       → token commande, status=pending, total=1000
2. POST /api/webhooks/payment                          → corps JSON :
   { id, type:"payment.succeeded",
     data:{ paymentId, orderToken:<token>, amountCents:1000, feeCents:0 } }
   en-tête x-mock-signature = HMAC-SHA256(corps, 'dev-only-webhook-secret-...')
   → outcome: "paid"
3. GET /api/orders/<token>  → status=paid, 1 billet avec QR signé valide, SANS avoir rien payé.
```

**Impact :** émission de billets payés **sans paiement réel** pour n'importe quelle commande (carte **ou** virement — cela court-circuite aussi la confirmation manuelle de virement par l'admin). Sur une instance de démo/staging exposée, un attaquant obtient des billets valides gratuits à volonté et peut corrompir la comptabilité (`feeCents`/`amountCents` arbitraires).

**Facteur atténuant :** en production, `config.js` **refuse de démarrer** si `WEBHOOK_SECRET` n'est pas défini avec ≥ 32 caractères, donc le secret y est fort et inconnu, et la forge est impossible. La faille vise les instances non-production.

**Ce qui tient (défenses correctes autour) :** signature invalide → 400 ; montant signé ≠ total serveur → remboursement automatique, aucun billet (testé avec montants `1`, `999999999`, `-5000`) ; double notification / double session concurrente → un seul lot de billets ; paiement tardif sur commande annulée → repris proprement (`paid_late`/`refunded_late`).

**Recommandation :**
- Ne **jamais** utiliser de secret codé en dur, même en dev : générer un `WEBHOOK_SECRET` aléatoire au premier démarrage (fichier `.env` local) plutôt qu'une constante publique partagée par tous les dépôts.
- En complément : restreindre l'origine du webhook (le prestataire simulé appelle en `localhost`) à `127.0.0.1` hors production.

---

### F1 — Outils de démo non authentifiés (fuite de données + manipulation métier) — Gravité : MOYENNE

**Où :** `server/src/routes/dev.js`, monté dans `server/src/app.js` via `if (devTools) app.use('/api/dev', devRouter)`.

**Problème :** le routeur `/api/dev/*` n'a **aucun `requireAuth`**. Toute personne pouvant joindre l'API lorsque `devTools` est actif peut, **sans se connecter** :

- `GET /api/dev/emails` et `GET /api/dev/emails/:id` : lire **toute la boîte mail**, dont les mails « billets » qui contiennent le **lien secret de commande** (`/commande/<token>`).
- `POST /api/dev/clock/advance` : **avancer l'horloge globale** du serveur → forcer l'expiration des réservations en attente, fermer les ventes, etc. (manipulation de la logique métier / DoS fonctionnel).

**Chaîne d'exploitation vérifiée** (instance locale, sans authentification) :

```
1. GET /api/dev/emails            → liste des mails (4 exposés)
2. GET /api/dev/emails/41         → HTML du mail « tickets » → token: nSWI265ep6V6y_hoo6nscXqy
3. GET /api/orders/nSWI265ep6...  → acheteur: Yanis Dubois | yanis.dubois.41@exemple.test
                                     statut: paid | total: 100,00 €
                                     billets avec QR signés valides :
                                     TKK1.qhmE1UBevfmwA_7k.xj... (+ 3 autres)
4. POST /api/dev/clock/advance {"minutes":60} → HTTP 200, horloge décalée de +60 min
```

**Impact :** le jeton de commande est censé être le seul secret protégeant une commande (pas d'IDOR car 144 bits aléatoires). La boîte mail ouverte **court-circuite entièrement ce secret** : fuite de PII (nom, e-mail), récupération de **QR codes signés valides** (entrée gratuite à l'événement), et possibilité d'**annuler/rembourser** les commandes d'autrui via `POST /api/orders/<token>/cancel`. La manipulation d'horloge permet un déni de service fonctionnel.

**Facteur atténuant :** `config.js` impose `devTools = !isProduction && flag('ENABLE_DEV_TOOLS', true)`, et refuse le démarrage en production sans secrets forts / HTTPS / `PAYMENT_PROVIDER≠mock`. En production, ces routes **ne sont jamais montées**. La faille vise donc les instances de démo/staging/dev — exactement le type d'instance qu'un auditeur ou un développeur expose.

**Recommandation :**
- Même en mode démo, protéger `/api/dev/*` par `requireAuth('superadmin')` (ou le lier à `127.0.0.1`).
- Ne pas inclure le jeton de commande en clair dans un flux lisible sans authentification, ou purger la boîte mail de démo des liens secrets.

---

### F2 — Identifiants de démo faibles et connus — Gravité : FAIBLE

**Où :** `server/src/seed.js` (`DEMO_PASSWORD = 'demo1234'`), appelé par `index.js` si la base est vide et `NODE_ENV !== 'production'`.

**Problème :** tous les comptes semés (`super@tickekette.test`, `admin@nuits.test`, …) partagent un mot de passe trivial et public. Sur une instance de démo exposée, la prise de contrôle admin/superadmin est immédiate.

**Facteur atténuant :** `seedDemo()` n'est jamais appelé en production.

**Recommandation :** générer un mot de passe aléatoire par compte de démo et l'afficher une seule fois dans les logs de seed ; documenter que les instances de démo ne doivent pas être exposées publiquement.

---

### F3 — `trustProxy` par défaut à 0 — Gravité : FAIBLE (déploiement)

**Où :** `server/src/config.js` → `trustProxy: Number(env.TRUST_PROXY) || 0` ; utilisé par le rate-limiting (`http/security.js`).

**Problème :** déployé derrière un reverse proxy sans définir `TRUST_PROXY`, `req.ip` vaut l'IP du proxy pour **tous** les clients. Le rate-limiting par IP (anti-brute-force connexion, anti-réservations abusives) devient alors soit global (tout le monde dans le même seau), soit inopérant pour isoler un attaquant. Les en-têtes `X-Forwarded-For` ne sont pas pris en compte.

**Recommandation :** documenter explicitement l'obligation de régler `TRUST_PROXY` selon l'infrastructure, et éventuellement refuser de démarrer en production si un proxy est détecté sans configuration.

---

### F4 — Horodatage de scan fourni par le client — Gravité : INFORMATION

**Où :** `server/src/services/scans.js` → `normalizeScanTime()`.

**Problème :** le champ `scannedAt` envoyé par le téléphone est accepté s'il est « plausible » (ni futur > 60 s, ni plus vieux que 24 h). Un contrôleur authentifié peut donc antidater/postdater une entrée dans cette fenêtre. Impact faible : les contrôleurs sont du personnel de confiance et cela n'affecte que l'horodatage affiché, pas la validité du billet. Comportement nécessaire au fonctionnement hors ligne (documenté).

**Recommandation :** conserver aussi `received_at` (déjà fait ✅) comme source de vérité pour toute analyse anti-fraude ; aucune action bloquante requise.

---

### F5 — Incohérence commentaire/contrainte dans le schéma — Gravité : COSMÉTIQUE

**Où :** `server/src/schema.js`. Le commentaire annonce `UNIQUE (provider, provider_payment_id)` alors que la contrainte réelle est `UNIQUE (provider, provider_payment_id, kind)`. Le **code est correct** (le `kind` est nécessaire pour autoriser un remboursement portant le même identifiant de paiement) ; seul le commentaire est trompeur.

**Recommandation :** corriger le commentaire.

---

### Findings mineurs & durcissement (m1–m14)

Passés en revue sur tout le dépôt. Aucun n'est une faille exploitable ; ce sont des pistes de durcissement.

| # | Observation | Où | Gravité | Pertinent en prod |
|---|---|---|---|---|
| m1 | Pas de `Cache-Control: no-store` sur les réponses sensibles (commande+PII+QR, stats/commandes admin, exports CSV) : un cache partagé/navigateur pourrait les conserver. | `app.js` / `http/security.js` | Faible | **Oui** |
| m2 | La déconnexion n'efface que le cookie ; le JWT reste valide jusqu'à 12 h (pas de blacklist / « token version »). Un changement de mot de passe n'invalide pas non plus les sessions. | `auth.js` | Faible | **Oui** |
| m3 | Coût bcrypt = 10 (≥ 12 conseillé en 2026), `bcryptjs` (JS pur) ; politique mdp minimale (8 car., aucune complexité, pas de liste d'interdits). | `auth.js`, `validation.js` | Faible | **Oui** |
| m4 | Pas de verrouillage de compte : seul le rate-limit par IP (10/15 min) freine le brute-force ; un attaquant multi-IP persiste (atténué par bcrypt). | `security.js` | Faible | **Oui** |
| m5 | Aucun rate-limit sur `/orders/:token` et surtout `/orders/:token/cancel` (annulation) ni sur `/events`, `/collectives`. Impact théorique (token 144 bits). | `public.js` | Très faible | Oui |
| m6 | `integer()` accepte `"1e3"`, `"0x10"` via `Number()` (toujours borné par min/max → sans impact). Normalisation plus laxiste que `routeId`. | `validation.js` | Informatif | — |
| m7 | `text()` n'interdit pas les caractères de contrôle / retours ligne / overrides RTL. Pas de XSS (sorties échappées), mais risque d'injection d'en-tête si un SMTP réel non-échappant recevait `subject` (contient `event.title`). | `validation.js`, `mailer.js` | Faible | Oui (selon SMTP) |
| m8 | Manifest hors ligne (noms participants + codes) en clair dans `localStorage` du contrôleur. Nécessité fonctionnelle, effacé à la déconnexion ; appareil volé → fuite PII. Les codes seuls ne forgent pas un QR valide (signature requise). | `client/utils/storage.ts` | Faible | Oui (confidentialité) |
| m9 | `amountCents`/`feeCents` du webhook stockés sans borne (hors signature) → corruption comptable sous F6. Inatteignable en prod sans le secret. | `payments.js` | Informatif | — |
| m10 | `strict: false` / `noImplicitAny: false` : vérification de types laxiste (qualité, pas sécurité). | `server/tsconfig.json` | Informatif | — |
| m11 | CSP `style-src 'unsafe-inline'` : injection de style possible (pas de script). Documenté/accepté. | `http/security.js` | Informatif | — |
| m12 | `confirm-transfer` : l'admin atteste la réception du virement sans contrôle du montant réellement reçu (abus interne possible, par conception). | `admin/transfers.js` | Informatif | — |
| m13 | `GET /mock-provider/sessions/:id` expose `order_token` dans `returnUrl` à qui possède l'id de session (96 bits, mock-only). | `payments.js` | Informatif | Non (mock) |
| m14 | Enumération possible : `joinWaitlist` répond `already_registered` → révèle qu'un e-mail est inscrit pour un type de place donné (nécessite de connaître événement+type+e-mail). | `waitlist.js` | Très faible | Oui |

---

## 5. Défenses vérifiées (points forts)

Validées par revue + pentest dynamique :

- **Anti-survente** garanti à deux niveaux : `UPDATE ... WHERE sold+held+? <= quota` atomique **et** `CHECK (sold + held <= quota)` en base. 200 achats concurrents → jamais plus que le quota. ✅
- **Prix recalculés côté serveur** : tout montant envoyé par le client est ignoré (`parseItems`, `inventory.pricing`). ✅
- **Webhook paiement** authentifié par **HMAC** avec comparaison à temps constant (`crypto.timingSafeEqual`) ; double notification neutralisée par `webhook_events.id` (PK) **et** `payments` UNIQUE ; montant comparé à `order.total_cents`, sinon remboursement. ✅
- **Isolation inter-collectifs (IDOR)** : rôle et `collective_id` toujours lus en base depuis `req.user`, jamais depuis la requête ; ressource d'un autre collectif → 404. ✅
- **Authentification** : JWT HS256 avec `algorithms` figé (pas de confusion `alg:none`), cookie `HttpOnly` + `SameSite=Strict` + `Secure` en prod, vérification de l'existence du compte à chaque requête (compte supprimé → accès coupé immédiatement). ✅
- **Anti-énumération de comptes** : hash factice à temps constant, message de connexion identique quelle que soit l'erreur. ✅
- **CSRF** : en-tête personnalisé obligatoire sur toute écriture, en complément de `SameSite=Strict` et de l'absence totale de CORS. ✅
- **QR codes signés** (HMAC tronqué) : capture retouchée rejetée (`parseScannedText` + `timingSafeEqual`). ✅
- **En-têtes HTTP** : CSP stricte (pas d'inline, pas d'`eval`), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, pas de `X-Powered-By`, HSTS en prod. ✅
- **Validation d'entrées** centralisée et stricte (longueurs, types, URL `http(s)` uniquement → `javascript:` refusé, booléens stricts, clé d'idempotence). ✅
- **Injection de formules CSV** neutralisée (`toCsv` préfixe `=+-@` d'une apostrophe). ✅
- **Pas de sink XSS côté client** (aucun `dangerouslySetInnerHTML`/`innerHTML`). ✅
- **Transactions** `BEGIN IMMEDIATE` sérialisant les écritures concurrentes ; **idempotence** des commandes par clé unique. ✅
- **Configuration de production défensive** : refus de démarrer sans secrets ≥ 32 car., sans HTTPS, ou avec le prestataire simulé / les outils de démo. ✅

---

## 6. Conclusion

Tickekette est un projet **très au-dessus de la moyenne** en matière de sécurité : modèle de menace explicite, garanties posées jusque dans le schéma SQL, et suite de tests qui vérifie les propriétés critiques. Même en attaquant la logique métier (forge de webhook, concurrence, montants falsifiés, pollution de prototype), **l'enveloppe de production tient : aucune faille exploitable en production** n'a été identifiée.

Les deux défauts réellement exploitables (**F6** forge de webhook, **F1** outils de démo) ont la **même cause racine** : en mode non-production, des points d'entrée puissants ne reposent que sur un **secret public codé en dur** ou sur **aucune authentification**. Ils sont dangereux dès qu'une instance non-production (démo, staging, poste de dev) est exposée au réseau — ce que la configuration de production empêche par ailleurs. Les autres points relèvent du durcissement de déploiement (F3) ou du cosmétique (F4, F5).

**Priorité de correction :**
1. **F6** — remplacer les secrets de dev codés en dur (`config.js`) par des secrets aléatoires générés localement, même hors production.
2. **F1** — exiger une authentification (`requireAuth('superadmin')`) ou un bind `127.0.0.1` sur les routes `/api/dev/*`.
3. **F3** — documenter/forcer `TRUST_PROXY` selon l'infrastructure.

---

## 7. Correctifs appliqués

Tous les correctifs ci-dessous ont été implémentés puis **vérifiés** (lint, typecheck, 55 tests serveur + 82 tests client au vert, et re-test dynamique).

| # | Correctif | Fichier(s) | Vérifié |
|---|---|---|---|
| **F6** | Suppression des secrets de dev codés en dur ; génération d'un secret **aléatoire par processus** hors production (plus rien de public dans le dépôt). | `config.js` | Webhook forgé avec l'ancien secret → **400** ✅ |
| **F1** | Outils de démo `/api/dev/*` restreints au **bouclage local** (adresse TCP réelle) et refus si `X-Forwarded-For` présent → `404`. Démo locale préservée. | `routes/dev.js` | Via proxy → **404**, loopback → **200** ✅ |
| **F5** | Commentaire du schéma corrigé (`UNIQUE (provider, provider_payment_id, kind)`). | `schema.js` | — |
| **m1** | `Cache-Control: no-store` sur toutes les réponses `/api` (pas de mise en cache de données personnelles). | `http/security.js`, `app.js` | En-tête présent ✅ |
| **m2** | Vraie invalidation de session : colonne `users.token_version` embarquée dans le JWT, vérifiée à chaque requête et **incrémentée à la déconnexion** (les jetons déjà émis deviennent inacceptables). | `schema.js`, `auth.js`, `routes/accounts.js` | Tests d'auth au vert ✅ |
| **m3** | Coût bcrypt relevé de **10 à 12**. | `auth.js` | Tests au vert ✅ |
| **m5** | Limite de débit ajoutée sur l'annulation de commande. | `routes/public.js` | — |
| **m6** | `integer()` rejette désormais les chaînes non décimales (`"1e3"`, `"0x10"`, `"1.5"`). | `validation.js` | — |
| **m7** | Sujet des mails nettoyé des CR/LF (anti-injection d'en-tête SMTP). | `services/mailer.js` | — |
| **m9** | Montant et frais du webhook bornés (0 … 10 M€) ; hors bornes → notification ignorée. | `routes/payments.js` | Montants falsifiés → aucun billet ✅ |

### Points volontairement non modifiés (par conception / accepté)

- **F2** (mots de passe de démo `demo1234`) : nécessaires au scénario de démonstration du README, et le seed est **interdit en production**. Documenter « ne pas exposer une instance de démo ».
- **F3** (`trustProxy=0`) : **valeur sûre par défaut** (ne pas faire confiance à des proxys inexistants évite l'usurpation d'IP). Déjà documentée dans `.env.example` ; à régler selon l'infrastructure réelle.
- **F4** (horodatage de scan ±24 h) : nécessaire au fonctionnement **hors ligne** ; `received_at` reste la source de vérité côté serveur.
- **m8** (manifest hors ligne en `localStorage`) : inhérent au contrôle hors ligne, effacé à la déconnexion ; un chiffrement côté navigateur sans gestion de clé n'apporterait pas de garantie réelle.
- **m10/m11** (tsconfig non `strict`, CSP `style-src 'unsafe-inline'`) : qualité de code / contrainte React, sans impact de sécurité exploitable.
- **m12/m13/m14** : informatifs (atteste admin du virement ; session mock ; énumération waitlist), sans correctif pertinent sans dégrader l'UX.
