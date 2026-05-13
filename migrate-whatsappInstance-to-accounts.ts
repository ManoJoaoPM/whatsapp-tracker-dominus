import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Client from './api/models/Client.js';
import WhatsAppAccount from './api/models/WhatsAppAccount.js';
import Conversation from './api/models/Conversation.js';
import Message from './api/models/Message.js';

dotenv.config();

type Mode = 'dry-run' | 'apply';

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  const mode: Mode = args.has('--apply') ? 'apply' : 'dry-run';
  const verbose = args.has('--verbose');
  return { mode, verbose };
};

const main = async () => {
  const { mode, verbose } = parseArgs();

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI não definido no .env');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log(`✅ Connected to MongoDB (${mode})`);

  const clients = await Client.find({
    'whatsappInstance.instanceId': { $exists: true, $ne: '' },
  });

  if (clients.length === 0) {
    console.log('ℹ️ Nenhum client com whatsappInstance.instanceId encontrado. Nada para migrar.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const instanceOwners = new Map<string, Set<string>>();
  for (const c of clients) {
    const instanceId = c.whatsappInstance?.instanceId;
    if (!instanceId) continue;
    const ownerSet = instanceOwners.get(instanceId) ?? new Set<string>();
    ownerSet.add(String(c._id));
    instanceOwners.set(instanceId, ownerSet);
  }

  const conflictsInClients = [...instanceOwners.entries()].filter(([, owners]) => owners.size > 1);
  if (conflictsInClients.length > 0) {
    console.error('❌ Conflito encontrado: o mesmo instanceId aparece em mais de um client.');
    for (const [instanceId, owners] of conflictsInClients) {
      console.error(`- instanceId=${instanceId} clients=${[...owners].join(', ')}`);
    }
    await mongoose.disconnect();
    process.exit(1);
  }

  const instanceIds = [...instanceOwners.keys()];
  const existingAccounts = await WhatsAppAccount.find({ instanceId: { $in: instanceIds } });
  const accountByInstanceId = new Map<string, typeof existingAccounts[number]>();
  for (const a of existingAccounts) {
    accountByInstanceId.set(a.instanceId, a);
  }

  const conflictsWithAccounts: Array<{ instanceId: string; expectedClientId: string; actualClientId: string }> =
    [];
  for (const [instanceId, owners] of instanceOwners) {
    const expectedClientId = [...owners][0];
    const account = accountByInstanceId.get(instanceId);
    if (!account) continue;
    const actualClientId = String(account.clientId);
    if (actualClientId !== expectedClientId) {
      conflictsWithAccounts.push({ instanceId, expectedClientId, actualClientId });
    }
  }

  if (conflictsWithAccounts.length > 0) {
    console.error('❌ Conflito encontrado: instanceId já existe em whatsappaccounts, mas aponta para outro clientId.');
    for (const c of conflictsWithAccounts) {
      console.error(`- instanceId=${c.instanceId} esperadoClient=${c.expectedClientId} atualClient=${c.actualClientId}`);
    }
    await mongoose.disconnect();
    process.exit(1);
  }

  let willCreate = 0;
  let willUpdate = 0;
  let convBackfillTotal = 0;
  let msgBackfillTotal = 0;

  for (const c of clients) {
    const wi = c.whatsappInstance;
    if (!wi?.instanceId) continue;

    const instanceId = wi.instanceId;
    const existing = accountByInstanceId.get(instanceId);
    if (existing) willUpdate += 1;
    else willCreate += 1;

    const convMissing = await Conversation.countDocuments({
      clientId: c._id,
      $or: [{ whatsappAccountId: { $exists: false } }, { whatsappAccountId: null }],
    });

    const msgMissing = await Message.countDocuments({
      clientId: c._id,
      $or: [{ whatsappAccountId: { $exists: false } }, { whatsappAccountId: null }],
    });

    convBackfillTotal += convMissing;
    msgBackfillTotal += msgMissing;

    if (verbose) {
      console.log(
        `- client=${c._id} instanceId=${instanceId} account=${existing?._id ?? 'new'} convMissing=${convMissing} msgMissing=${msgMissing}`
      );
    }
  }

  console.log('📊 Relatório');
  console.log(`- Clients com whatsappInstance: ${clients.length}`);
  console.log(`- WhatsAppAccounts: criar=${willCreate} atualizar=${willUpdate}`);
  console.log(`- Backfill: conversations=${convBackfillTotal} messages=${msgBackfillTotal}`);

  if (mode === 'dry-run') {
    console.log('ℹ️ Dry-run finalizado. Rode com --apply para aplicar a migração.');
    await mongoose.disconnect();
    process.exit(0);
  }

  let created = 0;
  let updated = 0;
  let convBackfilled = 0;
  let msgBackfilled = 0;

  for (const c of clients) {
    const wi = c.whatsappInstance;
    if (!wi?.instanceId) continue;

    const instanceId = wi.instanceId;
    const existedBefore = accountByInstanceId.get(instanceId);

    const account = await WhatsAppAccount.findOneAndUpdate(
      { instanceId },
      {
        $setOnInsert: {
          clientId: c._id,
          instanceId,
          createdAt: new Date(),
          displayName: 'Principal',
        },
        $set: {
          status: wi.status || 'pending',
          phoneNumber: wi.phoneNumber,
          connectedAt: wi.connectedAt,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (existedBefore) updated += 1;
    else created += 1;

    const dupes = await Conversation.aggregate([
      {
        $match: {
          clientId: c._id,
          $or: [
            { whatsappAccountId: account._id },
            { whatsappAccountId: { $exists: false } },
            { whatsappAccountId: null },
          ],
        },
      },
      { $group: { _id: '$contactPhone', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ]);

    if (dupes.length > 0) {
      console.error('❌ Duplicidade de conversas detectada ao tentar aplicar whatsappAccountId (amostra até 20).');
      for (const d of dupes) {
        console.error(`- client=${c._id} instanceId=${instanceId} contactPhone=${d._id} count=${d.count}`);
      }
      console.error('ℹ️ Resolva as duplicidades antes de rodar novamente.');
      await mongoose.disconnect();
      process.exit(1);
    }

    const convRes = await Conversation.updateMany(
      { clientId: c._id, $or: [{ whatsappAccountId: { $exists: false } }, { whatsappAccountId: null }] },
      { $set: { whatsappAccountId: account._id } }
    );

    const msgRes = await Message.updateMany(
      { clientId: c._id, $or: [{ whatsappAccountId: { $exists: false } }, { whatsappAccountId: null }] },
      { $set: { whatsappAccountId: account._id } }
    );

    convBackfilled += convRes.modifiedCount;
    msgBackfilled += msgRes.modifiedCount;

    accountByInstanceId.set(instanceId, account);
  }

  console.log('✅ Migração aplicada');
  console.log(`- WhatsAppAccounts: criados=${created} atualizados=${updated}`);
  console.log(`- Backfill: conversations=${convBackfilled} messages=${msgBackfilled}`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => {
  console.error('❌ Erro:', e);
  process.exit(1);
});
