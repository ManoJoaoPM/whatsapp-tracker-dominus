/**
 * Pre-flight checks for Meta Conversions API events.
 *
 * Meta rejects a whole batch when a single event is invalid, and for some mistakes it answers
 * HTTP 200 with `events_received: 0`, so we validate locally and never trust the status code alone.
 * Rules come from Meta's "Conversions API for Business Messaging" documentation.
 */

export const META_BUSINESS_MESSAGING_EVENTS = [
  'Purchase',
  'LeadSubmitted',
  'QualifiedLead',
  'InitiateCheckout',
  'AddToCart',
  'ViewContent',
  'OrderCreated',
  'OrderShipped',
  'OrderDelivered',
  'OrderCanceled',
  'OrderReturned',
  'CartAbandoned',
  'RatingProvided',
  'ReviewProvided',
] as const;

const EVENTS_REQUIRING_VALUE = new Set(['Purchase', 'OrderCreated']);

/** Meta rejects events older than 7 days */
export const META_EVENT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const isBusinessMessagingEventName = (name: unknown): boolean => {
  return typeof name === 'string' && (META_BUSINESS_MESSAGING_EVENTS as readonly string[]).includes(name);
};

export const validateMetaEvent = (event: any, nowSeconds: number = Math.floor(Date.now() / 1000)): string[] => {
  const issues: string[] = [];

  if (!event || typeof event !== 'object') return ['event is empty'];

  const name = event.event_name;
  const actionSource = event.action_source;

  if (typeof name !== 'string' || !name.trim()) {
    issues.push('event_name is required');
  } else if (actionSource === 'business_messaging' && !isBusinessMessagingEventName(name)) {
    issues.push(
      `event_name "${name}" is not accepted for business_messaging. Use one of: ${META_BUSINESS_MESSAGING_EVENTS.join(', ')}`,
    );
  }

  const time = event.event_time;
  if (typeof time !== 'number' || !Number.isInteger(time)) {
    issues.push('event_time must be an integer number of seconds');
  } else if (time > 1e11) {
    issues.push('event_time looks like milliseconds; Meta expects seconds');
  } else if (time > nowSeconds) {
    issues.push('event_time is in the future');
  } else if (nowSeconds - time > META_EVENT_MAX_AGE_SECONDS) {
    issues.push('event_time is older than 7 days');
  }

  if (typeof actionSource !== 'string' || !actionSource) {
    issues.push('action_source is required');
  }

  if (actionSource === 'business_messaging') {
    if (event.messaging_channel !== 'whatsapp') {
      issues.push('messaging_channel must be "whatsapp" for business_messaging events');
    }

    const clid = event.user_data?.ctwa_clid;
    if (typeof clid !== 'string' || !clid.trim()) {
      issues.push('user_data.ctwa_clid is required for business_messaging events');
    } else if (/\s/.test(clid)) {
      issues.push('user_data.ctwa_clid must not contain whitespace');
    }
  }

  if (typeof name === 'string' && EVENTS_REQUIRING_VALUE.has(name)) {
    const currency = event.custom_data?.currency;
    const value = event.custom_data?.value;
    if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
      issues.push(`${name} requires custom_data.currency (ISO 4217, e.g. BRL)`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(`${name} requires a numeric custom_data.value`);
    }
  }

  return issues;
};

/**
 * Meta answers 200 with `events_received: 0` for events it silently drops.
 * Only `events_received >= 1` counts as delivered.
 */
export const readEventsReceived = (responseData: any): number | null => {
  const n = responseData?.events_received;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export const wasEventAccepted = (responseData: any): boolean => {
  const received = readEventsReceived(responseData);
  return received !== null && received >= 1;
};
