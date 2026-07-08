import fs from 'node:fs';
import path from 'node:path';

const appRoot = process.env.APP_DIR || '/opt/vane';
const template = '/app/openhost/config.template.json';
const dataRoot = process.env.OPENHOST_APP_DATA_DIR || appRoot;
const dest = path.join(dataRoot, 'data', 'config.json');
const secretKey = 'OPENROUTER_API_KEY';

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

const key = await fetchSecret(secretKey);

if (!key && fs.existsSync(dest)) {
  console.log('[seed] no secret retrieved and config.json exists; leaving it untouched');
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(template, 'utf8'));
for (const provider of config.modelProviders || []) {
  if (provider && provider.type === 'openai' && provider.config) {
    provider.config.apiKey = key || '';
  }
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(config, null, 2));
console.log(`[seed] wrote ${dest} (OpenRouter key ${key ? 'loaded from OpenHost secrets' : 'EMPTY — set the OPENROUTER_API_KEY secret and grant permissions'})`);
