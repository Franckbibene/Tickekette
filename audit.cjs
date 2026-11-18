#!/usr/bin/env node
/**
 * audit.js — Analyseur statique de failles pour audit croisé (TP sécurité)
 *
 * Usage :
 *   node audit.js [chemin_vers_le_projet]
 *   (si aucun chemin n'est donné, analyse le dossier courant)
 *
 * Produit :
 *   - un affichage lisible dans le terminal
 *   - un fichier rapport-audit.md à côté du script, à recoller dans la conversation
 *
 * Ce script NE FAIT QUE LIRE le code. Il n'exploite rien, ne modifie rien.
 * C'est un point de départ : chaque "hit" doit être vérifié à la main.
 */

const fs = require("fs");
const path = require("path");

const target = process.argv[2] || ".";
const ROOT = path.resolve(target);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".vite", "out", ".cache", "vendor",
]);

const SCAN_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".json", ".env", ".sql", ".html",
]);

// ----------------------------------------------------------------------------
// Règles de détection. Chaque règle = une catégorie de faille à vérifier.
// "re" est testé ligne par ligne. "note" explique quoi vérifier derrière.
// ----------------------------------------------------------------------------
const RULES = [
  {
    id: "SQLi",
    label: "Injection SQL possible (concaténation / template dans une requête)",
    severity: "HAUTE",
    re: /(query|execute|prepare|run|get|all|exec)\s*\(\s*[`'"][^`'"]*(\$\{|\"?\s*\+\s*)/i,
    note: "Une requête construite avec + ou ${} au lieu de paramètres (?) est vulnérable. Vérifier que ce sont bien des requêtes préparées.",
  },
  {
    id: "SQLi-concat",
    label: "Chaîne SQL assemblée avec une variable",
    severity: "HAUTE",
    re: /(SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b[^;]*(\$\{|`\s*\+|'\s*\+\s*\w)/i,
    note: "Mot-clé SQL suivi d'une interpolation de variable. À inspecter de près.",
  },
  {
    id: "JWT-secret",
    label: "Secret JWT / clé en dur dans le code",
    severity: "HAUTE",
    re: /(jwt|token|secret|hmac|ticket_secret|webhook_secret)\s*[:=]\s*[`'"][A-Za-z0-9_\-!@#$%^&*]{6,}[`'"]/i,
    note: "Un secret écrit en dur (au lieu d'une variable d'environnement) peut servir à forger des JWT ou des QR codes valides.",
  },
  {
    id: "JWT-none",
    label: "JWT : algorithme 'none' ou vérification désactivée",
    severity: "HAUTE",
    re: /(algorithms?\s*:\s*\[?\s*['"]none['"]|ignoreExpiration\s*:\s*true|verify\s*:\s*false)/i,
    note: "Permet d'accepter un token non signé ou expiré. Faille d'authentification directe.",
  },
  {
    id: "JWT-decode",
    label: "jwt.decode() au lieu de jwt.verify()",
    severity: "HAUTE",
    re: /jwt\.decode\s*\(/i,
    note: "decode() ne vérifie PAS la signature. Si une route fait confiance au contenu d'un decode(), on peut forger un token.",
  },
  {
    id: "Tenant",
    label: "ID de collectif / tenant pris depuis la requête (risque de fuite entre collectifs)",
    severity: "HAUTE",
    re: /(collectif|tenant|org|organization)(_?id)?\s*[:=]\s*(req\.(body|query|params)|request\.)/i,
    note: "Le cahier des charges impose que le collectif vienne du compte connecté, jamais de la requête. Sinon un admin peut cibler un autre collectif.",
  },
  {
    id: "IDOR",
    label: "Accès à une ressource par ID sans filtre de propriétaire apparent",
    severity: "MOYENNE",
    re: /(findById|findOne|WHERE\s+id\s*=|get\(\s*['"]?SELECT[^)]*WHERE\s+id)/i,
    note: "Vérifier que la requête filtre AUSSI par le collectif/utilisateur courant, sinon IDOR (on accède à la commande/au billet d'un autre).",
  },
  {
    id: "AuthMiddleware",
    label: "Route définie — vérifier la présence d'un contrôle d'auth/rôle",
    severity: "INFO",
    re: /\b(router|app)\.(get|post|put|patch|delete)\s*\(/i,
    note: "Pour CHAQUE route : y a-t-il un middleware d'authentification et une vérification du rôle (admin/controller) ? Les routes admin sans garde sont la faille n°1.",
  },
  {
    id: "XSS-dsih",
    label: "dangerouslySetInnerHTML (React)",
    severity: "MOYENNE",
    re: /dangerouslySetInnerHTML/i,
    note: "Injection de HTML brut. Si la donnée vient de l'utilisateur (nom d'événement, commentaire), XSS possible.",
  },
  {
    id: "XSS-innerHTML",
    label: "innerHTML / document.write",
    severity: "MOYENNE",
    re: /(\.innerHTML\s*=|document\.write\s*\()/i,
    note: "Écriture de HTML non échappé. À tester avec un payload <img src=x onerror=alert(1)>.",
  },
  {
    id: "Secrets",
    label: "Mot de passe / clé API potentiellement en dur",
    severity: "HAUTE",
    re: /(password|passwd|api[_-]?key|apikey|private[_-]?key|aws_|secret_key)\s*[:=]\s*[`'"][^`'"]{4,}[`'"]/i,
    note: "Identifiant codé en dur dans les sources. Exclure les fichiers de démo/seed, mais vérifier le reste.",
  },
  {
    id: "CORS",
    label: "CORS ouvert à tout le monde",
    severity: "MOYENNE",
    re: /(origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*)/i,
    note: "Origin '*' combiné à des cookies/credentials = problème. À confronter à la gestion des sessions.",
  },
  {
    id: "HMAC-verify",
    label: "Signature HMAC / billet — vérifier qu'elle est contrôlée côté SERVEUR",
    severity: "HAUTE",
    re: /(createHmac|hmac|sign|signature|verify)/i,
    note: "Le QR code doit être validé côté serveur. Si la vérification n'existe QUE côté client, on peut falsifier un billet.",
  },
  {
    id: "Random-weak",
    label: "Génération aléatoire faible (Math.random)",
    severity: "MOYENNE",
    re: /Math\.random\s*\(/i,
    note: "Math.random n'est pas cryptographique. S'il sert à générer un code de billet/token, le code peut être prédit. Devrait être crypto.randomBytes.",
  },
  {
    id: "Price-trust",
    label: "Prix / quantité lus depuis la requête client",
    severity: "HAUTE",
    re: /(price|prix|amount|montant|quantity|quantite|qty|total)\s*[:=]\s*(req\.(body|query)|request\.)/i,
    note: "Le serveur ne doit jamais faire confiance au prix envoyé par le client. À tester : commander avec prix=0 ou quantité négative.",
  },
  {
    id: "Eval",
    label: "eval / Function() / exec dynamique",
    severity: "HAUTE",
    re: /\b(eval\s*\(|new\s+Function\s*\(|child_process|exec\s*\(|execSync\s*\()/i,
    note: "Exécution dynamique de code ou de commandes système. Vérifier qu'aucune entrée utilisateur n'y arrive.",
  },
  {
    id: "CSV-injection",
    label: "Export CSV — vérifier la protection contre l'injection de formules",
    severity: "MOYENNE",
    re: /(\.csv|text\/csv|writeFile.*csv|createReadStream.*csv|export.*csv)/i,
    note: "Une cellule commençant par = + - @ peut exécuter une formule dans Excel. Vérifier l'échappement.",
  },
  {
    id: "Debug",
    label: "Trace / log potentiellement verbeux en prod",
    severity: "INFO",
    re: /(console\.log\s*\(|stack\s*:|err\.stack|res\.(send|json)\s*\(\s*err)/i,
    note: "Renvoyer une stack trace ou l'objet erreur au client fuite des infos internes (requêtes SQL, chemins...).",
  },
];

// ----------------------------------------------------------------------------
const findings = {};
let filesScanned = 0;
let routesCount = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
    } else {
      const ext = path.extname(e.name).toLowerCase();
      const isEnv = e.name.startsWith(".env");
      if (SCAN_EXT.has(ext) || isEnv) scanFile(path.join(dir, e.name));
    }
  }
}

function scanFile(file) {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  filesScanned++;
  const rel = path.relative(ROOT, file);
  const lines = content.split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line.length > 400) return; // ignore les lignes minifiées
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        if (rule.id === "AuthMiddleware") routesCount++;
        (findings[rule.id] ||= []).push({
          file: rel,
          line: i + 1,
          text: line.trim().slice(0, 180),
        });
      }
    }
  });
}

// ----------------------------------------------------------------------------
console.log(`\n== Audit statique de : ${ROOT} ==\n`);
if (!fs.existsSync(ROOT)) {
  console.error("Chemin introuvable. Donne le chemin du projet en argument.");
  process.exit(1);
}
walk(ROOT);

const sevOrder = { HAUTE: 0, MOYENNE: 1, INFO: 2 };
const sortedRules = [...RULES].sort(
  (a, b) => sevOrder[a.severity] - sevOrder[b.severity]
);

let md = `# Rapport d'audit statique — Tickekette (audit croisé)\n\n`;
md += `Fichiers analysés : ${filesScanned}\n\n`;
md += `> Rapport automatique à base de motifs. Chaque résultat est une PISTE à vérifier manuellement, pas une faille confirmée.\n\n`;

for (const rule of sortedRules) {
  const hits = findings[rule.id];
  if (!hits || hits.length === 0) continue;

  const header = `[${rule.severity}] ${rule.label} — ${hits.length} résultat(s)`;
  console.log(header);

  md += `## [${rule.severity}] ${rule.label}\n\n`;
  md += `**Quoi vérifier :** ${rule.note}\n\n`;

  // on limite l'affichage pour ne pas noyer (surtout AuthMiddleware)
  const shown = hits.slice(0, rule.id === "AuthMiddleware" ? 60 : 40);
  for (const h of shown) {
    const loc = `  ${h.file}:${h.line}`;
    console.log(loc + "   " + h.text);
    md += `- \`${h.file}:${h.line}\` — \`${h.text.replace(/`/g, "'")}\`\n`;
  }
  if (hits.length > shown.length) {
    const more = `  … et ${hits.length - shown.length} autre(s)`;
    console.log(more);
    md += `- _… et ${hits.length - shown.length} autre(s)_\n`;
  }
  console.log("");
  md += `\n`;
}

if (Object.keys(findings).length === 0) {
  console.log("Aucun motif connu détecté (ça ne veut pas dire qu'il n'y a pas de faille).");
  md += `Aucun motif connu détecté.\n`;
}

// Petit récap + rappels d'actions manuelles
md += `## À faire à la main (le scanner ne peut pas le voir)\n\n`;
md += `- Rejouer chaque route API en changeant l'ID (IDOR) et le rôle du compte (élévation de privilège).\n`;
md += `- Tester la survente : plusieurs achats simultanés sur la dernière place.\n`;
md += `- Renvoyer deux fois le même webhook de paiement : un seul lot de billets doit être émis.\n`;
md += `- Falsifier un QR code et voir s'il passe le contrôle à l'entrée.\n`;
md += `- Lancer \`npm audit\` dans client/ et server/ pour les dépendances vulnérables.\n`;

const outPath = path.join(__dirname, "rapport-audit.md");
fs.writeFileSync(outPath, md, "utf8");

console.log("----------------------------------------------------");
console.log(`Routes trouvées (à contrôler une par une) : ${routesCount}`);
console.log(`Rapport écrit dans : ${outPath}`);
console.log("Ouvre-le, copie son contenu et recolle-le dans la conversation.");
