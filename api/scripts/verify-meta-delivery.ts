import assert from 'node:assert/strict';
import { attemptDelivery, type PostEvents } from '../services/metaEventQueue.js';
import { resolveCurrency, resolveMetaEventsConfig } from '../services/metaConversions.js';
import {
  MAX_DELIVERY_ATTEMPTS,
  RETRY_DELAYS_SECONDS,
  classifyDeliveryError,
  hasReachedTriggerLevel,
  nextRetryDelaySeconds,
} from '../services/metaRetryPolicy.js';

const now = 1_800_000_000;
const config = { pixelId: '123456789', pageId: 'PAGE_NEW', accessToken: 'tok' };

const event = () => ({
  event_name: 'QualifiedLead',
  event_time: now - 60,
  action_source: 'business_messaging',
  messaging_channel: 'whatsapp',
  event_id: 'conv1:QualifiedLead',
  user_data: { external_id: ['x'], ctwa_clid: 'CLID', page_id: 'PAGE_OLD' },
});

// axios-like errors
const httpError = (status: number, code?: number) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data: { error: { message: `meta says ${code}`, code } } },
});
const networkError = () => ({ message: 'timeout of 15000ms exceeded', code: 'ECONNABORTED' });

const failWith = (err: unknown): PostEvents => async () => {
  throw err;
};

const run = async () => {
  // --- success, and page_id follows the CURRENT configuration ---
  let sentBody: any;
  const ok = await attemptDelivery({
    event: event(),
    attemptsMade: 1,
    config,
    nowSeconds: now,
    post: async (url, body) => {
      sentBody = body;
      assert.ok(url.includes('/123456789/events'));
      return { status: 200, data: { events_received: 1, fbtrace_id: 'x' } };
    },
  });
  assert.equal(ok.outcome.kind, 'sent');
  assert.equal(sentBody.data[0].user_data.page_id, 'PAGE_NEW');
  assert.equal(sentBody.data[0].user_data.ctwa_clid, 'CLID');

  // page_id is removed when the integration no longer has one
  await attemptDelivery({
    event: event(),
    attemptsMade: 1,
    config: { ...config, pageId: undefined },
    nowSeconds: now,
    post: async (_u, body) => {
      sentBody = body;
      return { status: 200, data: { events_received: 1 } };
    },
  });
  assert.equal('page_id' in sentBody.data[0].user_data, false);

  // the stored event is never mutated by an attempt
  const stored = event();
  await attemptDelivery({ event: stored, attemptsMade: 1, config, nowSeconds: now, post: async () => ({ status: 200, data: { events_received: 1 } }) });
  assert.equal(stored.user_data.page_id, 'PAGE_OLD');

  // --- HTTP 200 but events_received 0: not delivered, retrying will not help ---
  const dropped = await attemptDelivery({
    event: event(), attemptsMade: 1, config, nowSeconds: now,
    post: async () => ({ status: 200, data: { events_received: 0 } }),
  });
  assert.equal(dropped.outcome.kind, 'failed');

  // --- temporary problems are retried with growing delays ---
  for (const err of [networkError(), httpError(500), httpError(503), httpError(429), httpError(400, 4), httpError(400, 17)]) {
    const r = await attemptDelivery({ event: event(), attemptsMade: 1, config, nowSeconds: now, post: failWith(err) });
    assert.equal(r.outcome.kind, 'retry', JSON.stringify(err));
    if (r.outcome.kind === 'retry') assert.equal(r.outcome.delaySeconds, RETRY_DELAYS_SECONDS[0]);
  }
  const second = await attemptDelivery({ event: event(), attemptsMade: 2, config, nowSeconds: now, post: failWith(networkError()) });
  assert.equal(second.outcome.kind === 'retry' && second.outcome.delaySeconds, RETRY_DELAYS_SECONDS[1]);

  // --- no attempts left -> gives up ---
  const exhausted = await attemptDelivery({
    event: event(), attemptsMade: MAX_DELIVERY_ATTEMPTS, config, nowSeconds: now, post: failWith(httpError(500)),
  });
  assert.equal(exhausted.outcome.kind, 'failed');
  assert.equal(nextRetryDelaySeconds(MAX_DELIVERY_ATTEMPTS), null);

  // --- permanent problems need a human: invalid token, permission, invalid parameter ---
  for (const err of [httpError(400, 190), httpError(400, 100), httpError(403, 200), httpError(400, 3)]) {
    const r = await attemptDelivery({ event: event(), attemptsMade: 1, config, nowSeconds: now, post: failWith(err) });
    assert.equal(r.outcome.kind, 'failed', JSON.stringify(err));
  }

  // --- configuration problems ---
  const noConfig = await attemptDelivery({ event: event(), attemptsMade: 1, config: null, nowSeconds: now, post: failWith(networkError()) });
  assert.equal(noConfig.outcome.kind, 'failed');

  // --- invalid / expired events never reach the network ---
  let called = false;
  const spy: PostEvents = async () => {
    called = true;
    return { status: 200, data: { events_received: 1 } };
  };
  const old = await attemptDelivery({
    event: { ...event(), event_time: now - 8 * 24 * 3600 }, attemptsMade: 1, config, nowSeconds: now, post: spy,
  });
  assert.equal(old.outcome.kind, 'failed');
  const wrongName = await attemptDelivery({
    event: { ...event(), event_name: 'qualified_lead' }, attemptsMade: 1, config, nowSeconds: now, post: spy,
  });
  assert.equal(wrongName.outcome.kind, 'failed');
  assert.equal(called, false);

  // --- classification details ---
  assert.equal(classifyDeliveryError(httpError(400, 190)).retryable, false);
  assert.equal(classifyDeliveryError(networkError()).retryable, true);
  assert.match(classifyDeliveryError(httpError(400, 100)).message, /meta says 100/);

  // --- trigger level is a minimum, not an exact match ---
  assert.equal(hasReachedTriggerLevel('hot', 'hot'), true);
  assert.equal(hasReachedTriggerLevel('hot', 'warm'), true);
  assert.equal(hasReachedTriggerLevel('warm', 'warm'), true);
  assert.equal(hasReachedTriggerLevel('warm', 'hot'), false);
  assert.equal(hasReachedTriggerLevel('cold', 'warm'), false);
  assert.equal(hasReachedTriggerLevel('cold', 'cold'), true);
  assert.equal(hasReachedTriggerLevel(undefined, 'cold'), false);
  assert.equal(hasReachedTriggerLevel('nonsense', 'cold'), false);

  // --- the three events of the ladder ---
  const ladder = (eventName: string, custom: Record<string, unknown> = {}) => ({
    ...event(),
    event_name: eventName,
    custom_data: { conversation_id: 'c1', ...custom },
  });
  const accept: PostEvents = async () => ({ status: 200, data: { events_received: 1 } });

  for (const name of ['LeadSubmitted', 'QualifiedLead']) {
    const r = await attemptDelivery({ event: ladder(name), attemptsMade: 1, config, nowSeconds: now, post: accept });
    assert.equal(r.outcome.kind, 'sent', name);
  }

  // Purchase needs a currency and a value
  const noValue = await attemptDelivery({ event: ladder('Purchase'), attemptsMade: 1, config, nowSeconds: now, post: spy });
  assert.equal(noValue.outcome.kind, 'failed');
  const withValue = await attemptDelivery({
    event: ladder('Purchase', { currency: 'BRL', value: 480000 }),
    attemptsMade: 1,
    config,
    nowSeconds: now,
    post: async (_u, body: any) => {
      assert.equal(body.data[0].custom_data.value, 480000);
      assert.equal(body.data[0].custom_data.currency, 'BRL');
      return { status: 200, data: { events_received: 1 } };
    },
  });
  assert.equal(withValue.outcome.kind, 'sent');

  // --- client configuration defaults keep the old behaviour ---
  assert.deepEqual(resolveMetaEventsConfig(undefined), {
    leadSubmitted: { enabled: false, minInbound: 2 },
    qualifiedLead: { enabled: true },
    purchase: { enabled: false },
  });
  assert.equal(resolveMetaEventsConfig({ qualifiedLead: { enabled: false } }).qualifiedLead.enabled, false);
  assert.equal(resolveMetaEventsConfig({ purchase: { enabled: true } }).purchase.enabled, true);
  assert.equal(resolveMetaEventsConfig({ leadSubmitted: { enabled: true, minInbound: 3 } }).leadSubmitted.minInbound, 3);
  assert.equal(resolveMetaEventsConfig({ leadSubmitted: { minInbound: 99 } }).leadSubmitted.minInbound, 2, 'out of range falls back');
  assert.equal(resolveCurrency('usd'), 'USD');
  assert.equal(resolveCurrency('reais'), 'BRL');
  assert.equal(resolveCurrency(undefined), 'BRL');

  console.log('verify-meta-delivery: ok');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
