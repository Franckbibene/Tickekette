# Tickekette — billetterie des collectifs bordelais

Application de billetterie pour **Les Nuits de la Garonne** et leurs collectifs partenaires :
vente sans survente, réservations qui expirent, paiement idempotent, liste d'attente automatique,
contrôle à l'entrée hors ligne et suivi des ventes en temps réel.

- **Front** : React 19 + TypeScript (strict) + Vite + React Router (`client/`)
- **Back** : Node.js + Express 5 + SQLite intégré à Node (`node:sqlite`, rien à installer) (`server/`)
- Node **22.9 ou plus récent** requis (développé avec Node 25).

## Démarrer

```bash
npm install
npm run dev
```

- Site : http://localhost:5173
- API : http://localhost:3001

Au premier lancement en développement, une base de démonstration est créée automatiquement.
`npm run seed` la réinitialise (arrêter `npm run dev` avant, les dates sont recalculées à partir de maintenant).

### Comptes de démonstration (développement uniquement)

Mot de passe : `demo1234`. Ces comptes n'existent que dans la base de démo : le jeu de données est refusé en
production et le bloc « comptes de démo » de la page de connexion est retiré du build de production.

| Compte                  | Rôle                                            |
| ----------------------- | ----------------------------------------------- |
| `admin@nuits.test`      | Admin — Les Nuits de la Garonne                 |
| `controle@nuits.test`   | Contrôleur à l'entrée — Les Nuits de la Garonne |
| `admin@bassins.test`    | Admin — Collectif Bassins                       |
| `admin@ondes.test`      | Admin — Ondes Lointaines (événements en ligne)  |
| `super@tickekette.test` | Super-admin de la plateforme                    |

## Qualité : une seule commande

```bash
npm run check
```

Enchaîne : `lint` (ESLint : TypeScript avec analyse de types, règles des hooks React, accessibilité jsx-a11y),
`format:check` (Prettier), `typecheck` (TypeScript strict côté front, `checkJs` côté serveur), `test`, `build`.

| Commande            | Rôle                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| `npm test`          | 55 tests serveur (`node:test`) + 82 tests front (Vitest, Testing Library) |
| `npm run lint`      | ESLint sur tout le dépôt                                                  |
| `npm run typecheck` | TypeScript front et serveur                                               |
| `npm run format`    | Formate le code (Prettier)                                                |

Les tests reprennent la recette du cahier des charges (section 10) et les points de sécurité :
50 achats simultanés pour la dernière place, notification de paiement reçue 2 ou 3 fois, double clic,
clé d'idempotence, expiration à 10 min et 48 h, virement en retard, liste d'attente, annulation,
deux téléphones hors ligne sur le même billet, QR code falsifié, séparation des collectifs, CSRF,
session falsifiée ou expirée, limites de débit, prix envoyé par le navigateur ignoré, valeurs limites
(0, -1, maximum, maximum + 1), redirections ouvertes, liens `javascript:`, en-têtes HTTP, configuration de production.

## Production

```bash
cp server/.env.example server/.env   # puis remplir les secrets
npm run build
npm start
```

Le serveur sert le front compilé sur un seul port. Il **refuse de démarrer** si un secret manque
(32 caractères minimum), si `PUBLIC_URL` n'est pas en HTTPS, ou si le paiement simulé est activé.
En production : pas de données de démo, pas de boîte mail de démo, pas de paiement simulé, pas de source maps.

## Sécurité : ce qui est protégé, et où

La règle suivie : **tout ce qui vient du navigateur est non fiable**. Le front améliore le confort
(validation immédiate, boutons désactivés, pages masquées), le serveur applique les règles.

| Risque                              | Protection côté serveur (la vraie)                                                                 | Côté front (confort)                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Survente, requêtes concurrentes     | Réservation atomique `UPDATE … WHERE sold + held + n <= quota` + contrainte `CHECK` en base        | Stepper borné par le stock affiché                          |
| Prix modifié dans DevTools          | Prix recalculé depuis la base ; tout prix envoyé est ignoré                                        | Total affiché à titre indicatif                             |
| Double réservation (double clic)    | Clé d'idempotence (`Idempotency-Key`, index unique)                                                | Bouton désactivé + verrou `useAsyncAction`                  |
| Paiement en double                  | Identifiants de notification et de paiement uniques, signature HMAC                                | —                                                           |
| Injection SQL                       | Requêtes préparées uniquement (paramètres liés)                                                    | —                                                           |
| XSS                                 | CSP stricte (`script-src 'self'`), mails échappés                                                  | Aucun `dangerouslySetInnerHTML`, liens `http(s)` vérifiés   |
| Vol de session                      | JWT dans un cookie `HttpOnly`, `SameSite=Strict`, `Secure` en prod, algorithme imposé              | Aucun jeton manipulé en JavaScript                          |
| CSRF                                | `SameSite=Strict` + en-tête `X-Requested-With` obligatoire, pas de CORS                            | En-tête ajouté par le client HTTP                           |
| Accès aux données d'un autre (IDOR) | Collectif pris dans la session, ressource étrangère = 404 ; commandes par jeton secret de 144 bits | `RequireRole` (redirection seulement)                       |
| Force brute, blocage du stock       | Limites de débit : connexion, réservations, liste d'attente, paiement                              | —                                                           |
| Énumération des comptes             | Même réponse et même durée (bcrypt sur un hash factice)                                            | —                                                           |
| Open redirect                       | —                                                                                                  | `safeInternalPath` sur les retours après connexion/paiement |
| Clickjacking, fuite par Referer     | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`                  | `rel="noopener noreferrer"`                                 |

## Scénario de démonstration (10 minutes)

1. **Achat** : ouvrir « Soirée Darwin », prendre 2 places Standard, payer par carte. Sur la page du prestataire
   simulé, la case « notification envoyée deux fois » est cochée : un seul lot de billets est émis.
2. **Liste d'attente** : le VIP de la même soirée est complet, s'inscrire sur la liste d'attente.
3. **Annulation → liste d'attente** : dans la **Boîte mail de démo** (bas de page), ouvrir le mail de billets VIP
   et annuler la commande. La place est proposée automatiquement à Anaïs, première inscrite (2 h pour payer).
4. **Expiration** : dans la boîte mail, avancer l'horloge de 2 h. L'offre d'Anaïs expire et passe à Karim.
5. **Tableau de bord** : se connecter en `admin@nuits.test`. Chiffres rafraîchis toutes les 5 s, commandes,
   liste d'attente, exports, virements à confirmer.
6. **Contrôle à l'entrée** : se connecter en `controle@nuits.test`, ouvrir « Apéro-concert du quai ». Scanner un QR
   code (caméra, ou saisie manuelle d'un nom), le rescanner : **DÉJÀ SCANNÉ**. Couper le réseau (DevTools → Offline) :
   le contrôle continue sur la liste téléchargée puis se synchronise au retour du réseau.
7. **Séparation des collectifs** : se connecter en `admin@bassins.test` : rien des Nuits de la Garonne n'est visible.

> La caméra du navigateur exige HTTPS ou `localhost`. Sur un vrai téléphone en HTTP, utiliser la saisie manuelle.

## Architecture

```
server/src/
  config.js          configuration, secrets obligatoires en production, hypothèses (délais…)
  validation.js      validation centralisée des entrées (types, bornes, formats)
  schema.js, db.js   tables, contraintes d'intégrité, requêtes préparées, transactions
  http/              en-têtes de sécurité, CSRF, limites de débit, gestion des erreurs
  services/          métier : inventory (stock, prix), orders, payments, waitlist, scans, mailer
  routes/            public, accounts, payments (webhook), scan, admin/ (events, stats, exports…), dev
client/src/
  api/               client HTTP unique (http.ts) + un module par domaine
  types/             types des réponses de l'API
  contexts/, hooks/  session, langue, chargement de données, actions asynchrones, scan hors ligne, caméra
  components/        common/, forms/, layout/, events/, orders/, admin/, scan/
  pages/             public/, admin/, scan/, dev/ (pages admin et contrôle chargées à la demande)
  routes/            routes, gardes de navigation, page 404
  utils/             fonctions pures testées : validation, prix, fuseaux, URL, décision de scan
```

Les hypothèses prises en attendant les réponses du client sont listées dans [HYPOTHESES.md](HYPOTHESES.md).

## Limites connues

- **Paiement réel** : seul le prestataire simulé existe. En production, le paiement carte répond « indisponible »
  tant qu'un prestataire (Stripe, SumUp…) n'est pas branché sur le même webhook signé et idempotent.
- **Mails** : écrits dans une boîte d'envoi en base ; l'envoi SMTP reste à brancher.
- **SQLite** convient à l'échelle du client (600 places maximum). Pour plusieurs serveurs : PostgreSQL
  (la réservation conditionnelle reste sûre grâce au verrouillage de ligne) et limites de débit partagées (Redis).
- **Hors ligne** : deux téléphones tous deux sans réseau peuvent valider le même billet ; le conflit est signalé
  à la synchronisation (hypothèse H13). La liste des billets (noms) est stockée sur le téléphone du contrôleur
  jusqu'à la déconnexion.
- **Styles** : la CSP autorise les styles inline (attributs `style` de React, HTML des mails de démo).
