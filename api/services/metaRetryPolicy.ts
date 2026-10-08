import { META_EVENT_MAX_AGE_SECONDS } from './metaEventValidation.js';

/** Wait before attempt N+1 after attempt N failed (seconds). 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h, 24 h */
export const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 10_800, 21_600, 43_200, 86_400] as const;

/** First try + one retry per delay */
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

/** A claimed event that nobody finished within this window is considered abandoned (crash, deploy) */
export const STUCK_LOCK_SECONDS = 5 * 60;

/** Meta error codes that mean "try again later": unknown/temporary, rate limits, throttling */
const TEMPORARY_META_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

export type DeliveryError = {
  retryable: boolean;
  message: string;
  httpStatus?: number;
  metaCode?: number;
  metaSubcode?: number;
};

/**
 * Decides whether a failed request is worth retrying.
 * Network problems, 5xx, 429 and Meta's temporary codes are retryable; everything else
 * (invalid token, missing permission, invalid parameter, rejected event) needs a human.
 */
export const classifyDeliveryError = (error: any): DeliveryError => {
  const httpStatus = typeof error?.response?.status === 'number' ? error.response.status : undefined;
  const meta = error?.response?.data?.error;
  const metaCode = typeof meta?.code === 'number' ? meta.code : undefined;
  const metaSubcode = typeof meta?.error_subcode === 'number' ? meta.error_subcode : undefined;

  const message = String(meta?.error_user_msg || meta?.message || error?.message || 'Meta CAPI error').slice(0, 500);

  if (!error?.response) {
    return { retryable: true, message, metaCode, metaSubcode };
  }

  if (httpStatus && (httpStatus >= 500 || httpStatus === 429)) {
    return { retryable: true, message, httpStatus, metaCode, metaSubcode };
  }

  if (metaCode !== undefined && TEMPORARY_META_CODES.has(metaCode)) {
    return { retryable: true, message, httpStatus, metaCode, metaSubcode };
  }

  return { retryable: false, message, httpStatus, metaCode, metaSubcode };
};

/** attemptsMade = how many attempts already happened (>= 1). Null when there are no retries left. */
export const nextRetryDelaySeconds = (attemptsMade: number): number | null => {
  const delay = RETRY_DELAYS_SECONDS[attemptsMade - 1];
  return delay === undefined ? null : delay;
};

export const isEventTooOld = (eventTimeSeconds: number, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean => {
  return nowSeconds - eventTimeSeconds > META_EVENT_MAX_AGE_SECONDS;
};

const LEVEL_RANK = { cold: 0, warm: 1, hot: 2 } as const;
type Level = keyof typeof LEVEL_RANK;

/**
 * The configured level is a minimum: with "warm" a lead that jumps straight to "hot"
 * qualifies too. Idempotency is guaranteed by the unique dedupe key of the event log,
 * so this can be evaluated on every scoring.
 */
export const hasReachedTriggerLevel = (current: string | undefined | null, trigger: Level): boolean => {
  if (!current || !(current in LEVEL_RANK)) return false;
  return LEVEL_RANK[current as Level] >= LEVEL_RANK[trigger];
};
