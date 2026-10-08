import assert from 'node:assert/strict';
import { buildMetaAdData, registerMetaClick } from '../services/attribution.js';
import {
  extractMetaReferralFromCloudMessage,
  extractMetaCtwaClidFromCloudMessage,
} from '../services/originDetection.js';

const fetchDetails = async ({ sourceId }: { sourceId: string }) => ({
  adId: sourceId,
  campaignId: `camp_${sourceId}`,
  campaignName: `Campanha ${sourceId}`,
});

const t0 = new Date('2026-10-01T10:00:00Z');
const t1 = new Date('2026-10-05T10:00:00Z');
const tOld = new Date('2026-09-20T10:00:00Z');

const newConversation = (): any => ({
  origin: 'unknown',
  originConfidence: 'auto',
  metaClicks: [],
});

const run = async () => {
  // messages without ad data change nothing
  const plain = newConversation();
  assert.equal(
    await registerMetaClick({ conversation: plain, clientId: 'c', ctwaClid: null, sourceId: null, externalAdReply: null, at: t0 }, fetchDetails),
    false,
  );
  assert.equal(plain.metaClicks.length, 0);
  assert.equal(plain.origin, 'unknown');

  // first click on an existing (organic) conversation upgrades it to meta_ads
  const conv = newConversation();
  assert.equal(
    await registerMetaClick(
      { conversation: conv, clientId: 'c', ctwaClid: 'CLID_1', sourceId: 'AD_1', externalAdReply: { title: 'Anúncio 1' }, at: t0 },
      fetchDetails,
    ),
    true,
  );
  assert.equal(conv.origin, 'meta_ads');
  assert.equal(conv.metaCtwaClid, 'CLID_1');
  assert.equal(conv.metaAdData.campaignName, 'Campanha AD_1');
  assert.equal(conv.metaAdData.adTitle, 'Anúncio 1');

  // the same click again is ignored (webhook retries / repeated payloads)
  assert.equal(
    await registerMetaClick({ conversation: conv, clientId: 'c', ctwaClid: 'CLID_1', sourceId: 'AD_1', externalAdReply: null, at: t1 }, fetchDetails),
    false,
  );
  assert.equal(conv.metaClicks.length, 1);

  // a NEW click from another ad: last click wins and old campaign data does not leak
  assert.equal(
    await registerMetaClick({ conversation: conv, clientId: 'c', ctwaClid: 'CLID_2', sourceId: 'AD_2', externalAdReply: null, at: t1 }, fetchDetails),
    true,
  );
  assert.equal(conv.metaCtwaClid, 'CLID_2');
  assert.equal(conv.metaAdData.campaignName, 'Campanha AD_2');
  assert.equal(conv.metaAdData.adTitle, undefined);
  assert.equal(conv.metaClicks.length, 2);

  // backlog (older click) is kept in the history but does not replace the current attribution
  assert.equal(
    await registerMetaClick({ conversation: conv, clientId: 'c', ctwaClid: 'CLID_OLD', sourceId: 'AD_0', externalAdReply: null, at: tOld }, fetchDetails),
    true,
  );
  assert.equal(conv.metaCtwaClid, 'CLID_2');
  assert.equal(conv.metaClicks.length, 3);

  // manual origin is respected
  const manual = newConversation();
  manual.originConfidence = 'manual';
  manual.origin = 'organic';
  await registerMetaClick({ conversation: manual, clientId: 'c', ctwaClid: 'CLID_M', sourceId: null, externalAdReply: null, at: t0 }, fetchDetails);
  assert.equal(manual.origin, 'organic');
  assert.equal(manual.metaCtwaClid, 'CLID_M');

  // history is capped
  const capped = newConversation();
  for (let i = 0; i < 25; i += 1) {
    await registerMetaClick(
      { conversation: capped, clientId: 'c', ctwaClid: `C${i}`, sourceId: null, externalAdReply: null, at: new Date(t0.getTime() + i * 1000) },
      fetchDetails,
    );
  }
  assert.equal(capped.metaClicks.length, 20);
  assert.equal(capped.metaCtwaClid, 'C24');

  // Graph API failure still keeps what the webhook carried
  const data = await buildMetaAdData(
    { clientId: 'c', sourceId: 'AD_X', externalAdReply: { title: 'T', mediaType: 2 } },
    async () => null,
  );
  assert.deepEqual(data, { sourceId: 'AD_X', adTitle: 'T', mediaType: '2' });
  assert.equal(await buildMetaAdData({ clientId: 'c', sourceId: null, externalAdReply: null }, fetchDetails), undefined);

  // Cloud API referral is normalised
  const cloudMsg = {
    id: 'wamid.1',
    referral: { source_id: 'AD_9', headline: 'Título', body: 'Corpo', media_type: 'image', image_url: 'http://img', ctwa_clid: 'CLID_C' },
  };
  assert.equal(extractMetaCtwaClidFromCloudMessage(cloudMsg), 'CLID_C');
  assert.deepEqual(extractMetaReferralFromCloudMessage(cloudMsg), {
    title: 'Título',
    body: 'Corpo',
    mediaType: 'image',
    thumbnailUrl: 'http://img',
    sourceUrl: undefined,
  });
  assert.equal(extractMetaReferralFromCloudMessage({ id: 'x' }), null);

  console.log('verify-attribution: ok');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
