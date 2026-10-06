import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
const SECRET_NAMES = ['JWT_SECRET', 'TICKET_SECRET', 'WEBHOOK_SECRET', 'DATA_ENCRYPTION_KEY'];

function createContents() {
  const generatedSecrets = SECRET_NAMES.map((name) => `${name}=${crypto.randomBytes(32).toString('hex')}`);

  return [
    '# Configuration locale générée automatiquement. Ne jamais versionner ce fichier.',
    '# Conserver ces valeurs : les changer invalide sessions, billets, MFA ou données chiffrées.',
    ...generatedSecrets,
    '',
    'PUBLIC_URL=http://localhost:5173',
    'API_PORT=3001',
    'PORT=3001',
    'TRUST_PROXY=0',
    '',
  ].join('\n');
}

/**
 * Crée une configuration locale privée sans jamais remplacer un fichier existant.
 *
 * @param {string} envPath
 * @returns {Promise<'created' | 'existing'>}
 */
export async function ensureLocalEnv(envPath = DEFAULT_ENV_PATH) {
  let createdFile;
  try {
    // wx garantit l'exclusivité : une exécution concurrente ne peut pas écraser les secrets.
    createdFile = await open(envPath, 'wx', 0o600);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;

    // O_NOFOLLOW refuse un .env qui serait un lien symbolique vers un autre fichier.
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const existingFile = await open(envPath, constants.O_RDONLY | noFollow);
    try {
      const stats = await existingFile.stat();
      if (!stats.isFile()) throw new Error('server/.env doit être un fichier ordinaire.');
      await existingFile.chmod(0o600);
    } finally {
      await existingFile.close();
    }
    return 'existing';
  }

  try {
    await createdFile.writeFile(createContents(), { encoding: 'utf8' });
    await createdFile.sync();
    await createdFile.chmod(0o600);
  } catch (error) {
    await createdFile.close();
    await unlink(envPath).catch(() => undefined);
    throw error;
  }
  await createdFile.close();
  return 'created';
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  const result = await ensureLocalEnv();
  console.info(
    result === 'created'
      ? 'Configuration locale privée créée dans server/.env (permissions 0600).'
      : 'Configuration locale existante conservée et protégée (permissions 0600).',
  );
}
