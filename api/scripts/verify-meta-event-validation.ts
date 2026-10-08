import assert from 'node:assert/strict';
import {
  isBusinessMessagingEventName,
  validateMetaEvent,
  wasEventAccepted,
} from '../services/metaEventValidation.js';

const now = 1_800_000_000;

const valid = {
  event_name: 'QualifiedLead',
  event_time: now - 60,
  action_source: 'business_messaging',
  messaging_channel: 'whatsapp',
  user_data: { ctwa_clid: 'AR_valid_clid' },
};

// valid event passes
assert.deepEqual(validateMetaEvent(valid, now), []);

// event names: official ones pass, the old lowercase name and "Lead" do not
assert.equal(isBusinessMessagingEventName('QualifiedLead'), true);
assert.equal(isBusinessMessagingEventName('LeadSubmitted'), true);
assert.equal(isBusinessMessagingEventName('qualified_lead'), false);
assert.equal(isBusinessMessagingEventName('Lead'), false);
assert.ok(validateMetaEvent({ ...valid, event_name: 'qualified_lead' }, now).length > 0);
assert.ok(validateMetaEvent({ ...valid, event_name: 'Lead' }, now).length > 0);

// non-messaging sources may use standard web names
assert.deepEqual(
  validateMetaEvent({ event_name: 'Lead', event_time: now, action_source: 'website' }, now),
  [],
);

// time rules
assert.ok(validateMetaEvent({ ...valid, event_time: now * 1000 }, now).some((i) => i.includes('milliseconds')));
assert.ok(validateMetaEvent({ ...valid, event_time: now + 600 }, now).some((i) => i.includes('future')));
assert.ok(validateMetaEvent({ ...valid, event_time: now - 8 * 24 * 3600 }, now).some((i) => i.includes('7 days')));
assert.deepEqual(validateMetaEvent({ ...valid, event_time: now - 6 * 24 * 3600 }, now), []);

// ctwa_clid and channel are mandatory for business messaging
assert.ok(validateMetaEvent({ ...valid, user_data: {} }, now).some((i) => i.includes('ctwa_clid')));
assert.ok(validateMetaEvent({ ...valid, user_data: { ctwa_clid: 'a b' } }, now).some((i) => i.includes('whitespace')));
assert.ok(validateMetaEvent({ ...valid, messaging_channel: undefined }, now).some((i) => i.includes('messaging_channel')));

// Purchase needs currency and numeric value
const purchase = { ...valid, event_name: 'Purchase' };
assert.ok(validateMetaEvent(purchase, now).length >= 2);
assert.deepEqual(
  validateMetaEvent({ ...purchase, custom_data: { currency: 'BRL', value: 1500 } }, now),
  [],
);

// HTTP 200 with events_received 0 is a failure
assert.equal(wasEventAccepted({ events_received: 1 }), true);
assert.equal(wasEventAccepted({ events_received: 0 }), false);
assert.equal(wasEventAccepted({}), false);
assert.equal(wasEventAccepted(undefined), false);

console.log('verify-meta-event-validation: ok');
