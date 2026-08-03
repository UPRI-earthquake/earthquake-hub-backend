const GENERATOR_VERSION = '1';
const APPROVED_ONLY_POLICY = 'approved_only';
const COMPATIBILITY_POLICY = 'compatibility';
const REVIEW_STATUSES = Object.freeze(['draft', 'needs_review', 'approved']);

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Asia/Manila',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  hour12: true,
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Asia/Manila',
});

function plainObject(value) {
  if (!value) return null;
  return typeof value.toObject === 'function' ? value.toObject() : value;
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formattedNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toFixed(digits).replace(/\.0$/, '');
}

function formattedCoordinate(value, positiveDirection, negativeDirection) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `${Math.abs(number).toFixed(3)}°${number >= 0 ? positiveDirection : negativeDirection}`;
}

function formattedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

function formattedTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : timeFormatter.format(date);
}

function proximityPhrase(place) {
  const normalized = normalizedText(place);
  if (!normalized || normalized.toLowerCase() === 'unavailable') return '';
  const match = normalized.match(/^(\d+)\s*km\s+(.+?)\s+of\s+(.+)$/i);
  if (!match) return normalized;
  return `${Number.parseInt(match[1], 10)} km ${match[2].trim()} of ${match[3].trim()}`;
}

function generateEventSummary(event) {
  const source = plainObject(event);
  if (!source) return '';

  const magnitude = formattedNumber(source.magnitude ?? source.magnitude_value, 1);
  const place = proximityPhrase(source.place)
    || normalizedText(source.location)
    || normalizedText(source.text);
  const eventTime = source.eventTime || source.OT;
  const depth = formattedNumber(source.depth ?? source.depth_value);
  const latitude = formattedCoordinate(
    source.lat ?? source.latitude ?? source.latitude_value,
    'N',
    'S',
  );
  const longitude = formattedCoordinate(
    source.lon ?? source.longitude ?? source.longitude_value,
    'E',
    'W',
  );

  let summary = `A magnitude ${magnitude} earthquake was recorded${place ? ` near ${place}` : ''} on ${formattedDate(eventTime)}, at ${formattedTime(eventTime)} PHT, with a reported depth of ${depth} km.`;
  if (latitude && longitude) {
    summary += ` The reported epicenter was located at ${latitude} latitude and ${longitude} longitude.`;
  }
  return summary;
}

function summaryReviewStatus(summaryOverride) {
  if (!normalizedText(summaryOverride?.text)) return 'none';
  return REVIEW_STATUSES.includes(summaryOverride.reviewStatus)
    ? summaryOverride.reviewStatus
    : 'draft';
}

function allowUnapprovedCompatibility(env = process.env) {
  return String(env.EVENT_SUMMARY_ALLOW_UNAPPROVED_COMPAT || '').trim().toLowerCase() === 'true';
}

function resolveEventSummary(event, { allowUnapproved = allowUnapprovedCompatibility() } = {}) {
  const source = plainObject(event) || {};
  const generatedSummary = generateEventSummary(source);
  const customText = normalizedText(source.summaryOverride?.text);
  const reviewStatus = summaryReviewStatus(source.summaryOverride);
  const approved = Boolean(customText) && reviewStatus === 'approved';
  const compatibilityPublished = Boolean(customText) && !approved && allowUnapproved;
  const customPublished = approved || compatibilityPublished;

  return {
    generatedSummary,
    effectiveSummary: customPublished ? customText : generatedSummary,
    reviewStatus,
    customSummaryAvailable: Boolean(customText),
    customSummaryPublished: customPublished,
    compatibilityMode: allowUnapproved,
    policy: allowUnapproved ? COMPATIBILITY_POLICY : APPROVED_ONLY_POLICY,
    source: approved
      ? 'approved_custom'
      : compatibilityPublished
        ? 'compatibility_custom'
        : 'generated',
  };
}

function publicationMetadata(resolution, { admin = false } = {}) {
  return {
    policy: resolution.policy,
    source: resolution.source,
    generatorVersion: GENERATOR_VERSION,
    compatibilityMode: resolution.compatibilityMode,
    ...(admin ? {
      customReviewStatus: resolution.reviewStatus,
      customSummaryAvailable: resolution.customSummaryAvailable,
      customSummaryPublished: resolution.customSummaryPublished,
    } : {}),
  };
}

function serializePublicEvent(event, options = {}) {
  const source = plainObject(event);
  if (!source) return null;
  const resolution = resolveEventSummary(source, options);
  const payload = {
    ...source,
    generatedSummary: resolution.generatedSummary,
    effectiveSummary: resolution.effectiveSummary,
    eventSummary: resolution.effectiveSummary,
    summaryPublication: publicationMetadata(resolution),
  };

  delete payload.summaryOverride;
  if (resolution.customSummaryPublished) {
    payload.summaryOverride = {
      text: resolution.effectiveSummary,
      reviewStatus: resolution.reviewStatus,
    };
  }
  return payload;
}

function enrichAdminEvent(event, options = {}) {
  const source = plainObject(event);
  if (!source) return null;
  const resolution = resolveEventSummary(source, options);
  return {
    ...source,
    generatedSummary: resolution.generatedSummary,
    effectiveSummary: resolution.effectiveSummary,
    eventSummary: resolution.effectiveSummary,
    summaryPublication: publicationMetadata(resolution, { admin: true }),
  };
}

module.exports = {
  APPROVED_ONLY_POLICY,
  COMPATIBILITY_POLICY,
  GENERATOR_VERSION,
  REVIEW_STATUSES,
  allowUnapprovedCompatibility,
  enrichAdminEvent,
  generateEventSummary,
  resolveEventSummary,
  serializePublicEvent,
  summaryReviewStatus,
};
