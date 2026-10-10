/** Generate new client-preview access locally; never print the password. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPasswordRecord } from '../server/project-admin/security.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.artifacts', 'hetzner-preview-access');
await fs.mkdir(directory, {recursive: true, mode: 0o700});
if (await fs.realpath(directory) !== path.resolve(directory)) throw new Error('Access directory must not traverse links.');
const password = 'LBI-' + crypto.randomBytes(24).toString('base64url');
const credential = path.join(directory, 'client-access.txt');
const hashFile = path.join(directory, 'password.json');
if (await fs.lstat(credential).catch(() => null) || await fs.lstat(hashFile).catch(() => null)) {
  throw new Error('Access files already exist; never rotate a deployed client password implicitly.');
}
const record = await createPasswordRecord(password);
await fs.writeFile(hashFile, JSON.stringify(record, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
await fs.writeFile(credential, [
  'LBI — toegang tot het projectenpaneel (klantpreview)',
  'URL: https://lbi-preview.178-105-195-84.sslip.io/beheer/projecten/',
  `Wachtwoord: ${password}`,
  '',
  'Bewaar dit bestand prive. Deel het wachtwoord afzonderlijk met de klant.',
  'Geen GitHub-account of gebruikersnaam nodig.',
  'Lokale broncodes, testgegevens en backups bevatten dit wachtwoord niet.',
  '',
].join('\n'), {mode: 0o600, flag: 'wx'});
console.log(JSON.stringify({status: 'CREATED', credential, hashFile, passwordPrinted: false}));
