import assert from 'node:assert/strict';
import { extractMetaCtwaClidFromEvolutionMessage } from '../services/originDetection.js';

const sampleRoot = {
  message: {
    broadcast: false,
    participantId: null,
    externalAdReply: {
      sourceType: 'ad',
      sourceApp: 'facebook',
      ctwaClid: 'AR_test_ctwaClid',
    },
  },
};

const sampleNested = {
  message: {
    extendedTextMessage: {
      text: 'oi',
      contextInfo: {
        externalAdReply: {
          ctwaClid: 'AR_nested_ctwaClid',
        },
      },
    },
  },
};

const sampleNone = { message: { conversation: 'hello' } };

assert.equal(extractMetaCtwaClidFromEvolutionMessage(sampleRoot), 'AR_test_ctwaClid');
assert.equal(extractMetaCtwaClidFromEvolutionMessage(sampleNested), 'AR_nested_ctwaClid');
assert.equal(extractMetaCtwaClidFromEvolutionMessage(sampleNone), null);

console.log('verify-origin-detection: ok');

