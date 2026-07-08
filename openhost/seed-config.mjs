/*
 * OpenHost config seeding for Vane.
 *
 * Runs once at container startup (from entrypoint.sh, before the Vane server).
 * It renders openhost/config.template.json into the app's persistent data
 * directory, injecting the OpenRouter API key fetched from the OpenHost
 * secrets service. The key is NEVER stored in the repo or the image — only in
 * OpenHost secrets — so a fresh deploy comes up fully configured with no manual
 * setup, and rotating the secret + reloading updates the key.
 *
 * Safety: if the secret can't be retrieved (permission not yet granted, secrets
 * app down, key unset) AND a config already exists, the existing config is left
 * untouched rather than being clobbered with an empty key.
 */
import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = '/home/vane';
const TEMPLATE = path.join(APP_ROOT, 'openhost', 'config.template.json');
// Vane reads config at path.join(DATA_DIR || cwd, '/data/config.json'); cwd is
// /home/vane and /home/vane/data is symlinked to OPENHOST_APP_DATA_DIR/data.
const DEST = path.join(process.env.DATA_DIR || APP_ROOT, 'data', 'config.json');
const SECRET_KEY = 'OPENROUTER_API_KEY';

async function fetchSecret(name) {
  const router = process.env.OPENHOST_ROUTER_URL;
  const token = process.env.OPENHOST_APP_TOKEN;
  if (!router || !token) {
    console.error('[seed] OPENHOST_ROUTER_URL / OPENHOST_APP_TOKEN not set; skipping secret fetch');
    return '';
  }
  try {
    const res = await fetch(`${router}/api/services/v2/call/secrets/get`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keys: [name] }),
    });
    if (!res.ok) {
      console.error(`[seed] secrets fetch returned HTTP ${res.status}`);
      return '';
    }
    const data = await res.json();
    return (data && data.secrets && data.secrets[name]) || '';
  } catch (err) {
    console.error('[seed] secrets fetch failed:', err && err.message);
    return '';
  }
}

const key = await fetchSecret(SECRET_KEY);

if (!key && fs.existsSync(DEST)) {
  console.log('[seed] no secret retrieved and config.json exists; leaving it untouched');
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
for (const provider of config.modelProviders || []) {
  if (provider && provider.type === 'openai' && provider.config) {
    provider.config.apiKey = key || '';
  }
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.writeFileSync(DEST, JSON.stringify(config, null, 2));
console.log(`[seed] wrote ${DEST} (OpenRouter key ${key ? 'loaded from OpenHost secrets' : 'EMPTY — set the OPENROUTER_API_KEY secret'})`);
