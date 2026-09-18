# Tickekette — billetterie des collectifs bordelais

Application de billetterie pour **Les Nuits de la Garonne** et leurs collectifs partenaires :
vente sans survente, réservations qui expirent, paiement idempotent, liste d'attente automatique,
contrôle à l'entrée hors ligne et suivi des ventes en temps réel.

- **Front** : React 19 + Vite + React Router (`client/`)
- **Back** : Node.js + Express 5 + SQLite intégré à Node (`node:sqlite`, rien à installer) (`server/`)
- Node **22.5 ou plus récent** requis (développé avec Node 25).

## Démarrer

```bash
npm install
npm run dev
```

- Site : http://localhost:5173
- API : http://localhost:3001

Au premier lancement, une base de démonstration est créée automatiquement.
`npm run seed` la réinitialise (les dates sont recalculées à partir de maintenant).

### Comptes de démonstration (mot de passe `demo1234`)

| Compte | Rôle |
|---|---|
| `admin@nuits.test` | Admin — Les Nuits de la Garonne |
| `controle@nuits.test` | Contrôleur à l'entrée — Les Nuits de la Garonne |
| `admin@bassins.test` | Admin — Collectif Bassins |
| `admin@ondes.test` | Admin — Ondes Lointaines (événements en ligne) |
| `super@tickekette.test` | Super-admin de la plateforme |

### Tests des scénarios critiques

```bash
npm test
```

17 tests reprennent la section 10 (recette) du cahier des charges : 50 achats simultanés pour la dernière
place, notification de paiement reçue deux ou trois fois, expiration à 10 min et 48 h, virement en retard,
liste d'attente, annulation, deux téléphones hors ligne qui scannent le même billet, QR code falsifié,
séparation des collectifs, tarif early.

### Production

```bash
npm run build
npm start
```

Le serveur sert alors le front compilé sur un seul port (`PORT`, 3001 par défaut). À définir :
`JWT_SECRET`, `TICKET_SECRET`, `WEBHOOK_SECRET`, `PUBLIC_URL`. Les outils de démo (`/dev/mails`, horloge)
sont désactivés en production.

## Scénario de démonstration (10 minutes)

1. **Achat** : sur l'accueil, ouvrir « Soirée Darwin », prendre 2 places Standard, payer par carte.
   Sur la page du prestataire simulé, la case « notification envoyée deux fois » est cochée : un seul lot de billets est émis.
2. **Liste d'attente** : sur la même soirée, le VIP est complet. S'inscrire sur la liste d'attente.
3. **Annulation → liste d'attente** : ouvrir le mail de billets dans la **Boîte mail de démo** (lien en bas de page),
   annuler une commande VIP depuis sa page. La place est proposée automatiquement à Anaïs, première inscrite :
   elle reçoit un mail et a 2 h pour payer.
4. **Expiration** : dans la boîte mail, avancer l'horloge de 2 h. L'offre d'Anaïs expire et passe à Karim.
   Faire de même avec une réservation carte non payée (+11 min).
5. **Tableau de bord** : se connecter en `admin@nuits.test`. Chiffres par type de place rafraîchis toutes les 5 s,
   commandes, liste d'attente, export des participants, export comptable, virements à confirmer.
6. **Contrôle à l'entrée** : se connecter en `controle@nuits.test`, ouvrir « Apéro-concert du quai ».
   Scanner le QR code d'un billet (caméra, ou saisie manuelle d'un nom). Le rescanner : **DÉJÀ SCANNÉ**.
   Couper le réseau (mode avion ou DevTools → Offline) : le contrôle continue sur la liste téléchargée,
   puis se synchronise au retour du réseau.
7. **Séparation des collectifs** : se connecter en `admin@bassins.test`. Aucun événement ni chiffre des Nuits de la Garonne n'est visible.

> La caméra du navigateur exige HTTPS ou `localhost`. Pour tester sur un vrai téléphone, utiliser la saisie manuelle
> ou servir le site en HTTPS.

## Correspondance cahier des charges → code

| Exigence | Implémentation |
|---|---|
| ⚠️ 5.2 Aucune survente | Réservation atomique `UPDATE … WHERE sold + held + n <= quota` dans une transaction `BEGIN IMMEDIATE`, plus une contrainte `CHECK (sold + held <= quota)` en base — `server/src/services/sales.js`, `schema.js` |
| ⚠️ 5.2 Délai de paiement | Chaque réservation a une date d'expiration (10 min carte / 48 h virement) ; libération toutes les 10 s et avant chaque achat — `sweepExpired()` |
| 5.2 Paiement après expiration | `recordPayment()` : validé s'il reste des places, sinon remboursé |
| ⚠️ 5.3 Notification en double | Double protection : identifiant de notification unique (`webhook_events`) + identifiant de paiement unique (`payments`) ; signature HMAC vérifiée — `server/src/routes/payments.js` |
| 5.4 Liste d'attente | Les places libérées sont réservées pour la 1re personne en attente avant d'être visibles du public ; délai de 2 h puis personne suivante — `processWaitlist()` |
| 5.5 Annulation | Délai réglable par événement, remboursement, place rendue à la liste d'attente — `cancelOrderByBuyer()` |
| 5.6 Billet | Code aléatoire de 96 bits + signature HMAC dans le QR code ; mails écrits dans la même transaction que l'action |
| ⚠️ 5.7 Contrôle hors ligne | Liste des billets téléchargée sur le téléphone, décision locale, file de scans synchronisée et rejouable (`client_scan_id` unique), conflits signalés — `client/src/pages/scan/Scanner.jsx`, `server/src/services/scans.js`, service worker `client/public/sw.js` |
| 5.8 Tableau de bord | Vendues, réservées non payées, remboursées, restantes par type ; brut, frais, net ; entrées ; alertes — `AdminEventDetail.jsx` |
| 5.9 Exports | CSV compatible Excel (BOM UTF-8, `;`, protection contre l'injection de formules) |
| 5.10 Fuseaux et langue | Dates stockées en UTC avec le fuseau de l'événement ; affichage à l'heure du lieu + à l'heure du visiteur ; pages publiques FR/EN |
| 4.1 Multi-collectifs | Le collectif vient toujours du compte connecté, jamais de la requête ; ressource d'un autre collectif = 404 |
| 3.5 Rôles | `superadmin` (collectifs, sans chiffres), `admin` (tout son collectif), `controller` (scan uniquement) |

Les hypothèses prises en attendant les réponses du client sont listées dans [HYPOTHESES.md](HYPOTHESES.md).

## Arborescence

```
server/
  src/
    config.js        paramètres et hypothèses (délais, frais…)
    schema.js        tables SQLite et contraintes d'intégrité
    services/
      sales.js       stock, commandes, paiements, liste d'attente, annulations
      scans.js       contrôle à l'entrée
      mailer.js      mails (FR/EN)
      tickets.js     codes et signature des QR codes
    routes/          public, admin, scan, paiements, comptes, outils de démo
  test/critical.test.js
client/
  src/
    pages/public/    vitrine, événement, commande, paiement simulé, connexion
    pages/admin/     événements, formulaire, tableau de bord, virements, équipe, plateforme
    pages/scan/      contrôle à l'entrée (caméra + hors ligne)
    pages/dev/       boîte mail de démo et horloge
```

## Limites connues

- SQLite convient à l'échelle du client (15 événements par an, 600 places au maximum). Pour plusieurs serveurs,
  passer à PostgreSQL : la même requête de réservation conditionnelle reste sûre grâce au verrouillage de ligne.
- Deux téléphones **tous deux hors ligne** peuvent valider le même billet : c'est inévitable sans réseau.
  Le conflit est détecté et signalé à la synchronisation (hypothèse H13).
