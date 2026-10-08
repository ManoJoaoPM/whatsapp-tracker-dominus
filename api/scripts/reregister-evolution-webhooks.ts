/**
 * Re-registers the webhook of every Evolution instance with the current URL
 * (including EVOLUTION_WEBHOOK_TOKEN). Run after setting the token:
 *
 *   npx tsx api/scripts/reregister-evolution-webhooks.ts
 *
 * Only after every instance is migrated should you rely on the token being enforced.
 */
import '../config/env.js';
import mongoose from 'mongoose';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import { buildEvolutionWebhookUrl, setWebhook } from '../services/evolutionService.js';

const run = async () => {
  if (!String(process.env.EVOLUTION_WEBHOOK_TOKEN || '').trim()) {
    console.error('EVOLUTION_WEBHOOK_TOKEN is not set. Set it in .env first.');
    process.exit(1);
  }
  if (!String(process.env.APP_URL || '').trim()) {
    console.error('APP_URL is not set.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || '');

  const accounts = await WhatsAppAccount.find({
    provider: { $ne: 'cloud' },
    instanceId: { $type: 'string' },
  });

  const url = buildEvolutionWebhookUrl();
  let ok = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      await setWebhook(String(account.instanceId), url);
      ok += 1;
      console.log(`ok     ${account.instanceId}`);
    } catch (error: any) {
      failed += 1;
      console.error(`failed ${account.instanceId}: ${error?.message || error}`);
    }
  }

  console.log(`done: ${ok} updated, ${failed} failed, ${accounts.length} total`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
