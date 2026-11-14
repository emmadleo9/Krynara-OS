import fs from 'node:fs';
import { TdlibClient } from './tdlib-client.js';
import { readCredentials } from './tdlib-auth.js';

const { apiId, apiHash, configured } = readCredentials();
console.log('configured:', configured, 'apiId length:', String(apiId).length);

const client = new TdlibClient({
  onUpdate: (msg) => {
    if (msg['@type'] === 'updateAuthorizationState') {
      console.log('UPDATE authorizationState:', JSON.stringify(msg.authorization_state));
    }
  },
});

const call = async (label, request) => {
  try {
    const res = await client.sendAndWait(request, 20000);
    console.log(`${label}:`, JSON.stringify(res).slice(0, 300));
    return res;
  } catch (error) {
    console.log(`${label} FAILED:`, error.message);
    return null;
  }
};

await call('getAuthorizationState(1)', { '@type': 'getAuthorizationState' });
await call('setTdlibParameters', {
  '@type': 'setTdlibParameters',
  use_test_dc: false,
  database_directory: './data/tdlib',
  files_directory: './data/files',
  database_encryption_key: '',
  use_storage_optimizer: true,
  api_id: apiId,
  api_hash: apiHash,
  system_language_code: 'en',
  device_model: 'Krynara-OS',
  application_version: '1.0.0',
});

await new Promise((r) => setTimeout(r, 4000));

await call('getAuthorizationState(2)', { '@type': 'getAuthorizationState' });
await new Promise((r) => setTimeout(r, 1000));

client.close();
process.exit(0);