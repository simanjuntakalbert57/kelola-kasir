import { generateKeyPairSync } from 'node:crypto';

// Prints a base64 Ed25519 private key for JWT_PRIVATE_KEY. Store it in the platform secret manager.
const pem = generateKeyPairSync('ed25519')
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
process.stdout.write(`${Buffer.from(pem).toString('base64')}\n`);
