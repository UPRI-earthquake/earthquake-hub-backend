// The significance score that picks the significant earthquakes (POSTGRES.md, "Significant
// earthquakes"). Based on the USGS significance score
// (https://earthquake.usgs.gov/earthquakes/statistics/significant.php): its magnitude term and its
// 600 cut-off are kept; distance and depth weights stand in for its PAGER term, which needs impact
// estimates we don't have, and our own community reports for its "Did You Feel It?" term.
//
//   score = magnitude term x distance weight x depth weight + felt-report bonus
//
// Pure functions: the events repository finds the candidates (with their distance to the Philippines
// and their number of reporters), and these score, pick and order them.

const SIGNIFICANT_SCORE = 600; // the USGS cut-off
const MAX_SIGNIFICANT = 50;
const FULL_WEIGHT_KM = 200; // full weight within this distance of the Philippines
const ZERO_WEIGHT_KM = 1500; // no weight from this distance on
const REPORT_POINTS = 25;
const MAX_REPORTERS = 20;

// A simplified outline of the Philippines, [longitude, latitude], with the seas between the islands
// included: distances are measured to it, so an event inside it is 0 km away
const PHILIPPINES_OUTLINE = [
  [121.95, 21.15], [122.3, 18.6], [122.55, 17.0], [122.0, 15.5], [124.3, 14.1], [125.3, 12.6],
  [125.8, 11.0], [125.7, 10.0], [126.6, 8.5], [126.6, 6.2], [125.7, 5.4], [124.0, 5.9], [122.0, 6.8],
  [119.3, 4.5], [117.0, 7.6], [119.2, 11.5], [120.0, 13.5], [119.7, 16.3], [120.3, 18.5], [121.3, 20.2],
  [121.95, 21.15],
];
const PHILIPPINES_OUTLINE_WKT = `SRID=4326;POLYGON((${PHILIPPINES_OUTLINE.map(([lon, lat]) => `${lon} ${lat}`).join(', ')}))`;

// 100 x M² / 6.5: M6.5 scores 650, M7.0 754
const magnitudeTerm = (magnitude) => (100 * magnitude * magnitude) / 6.5;

// 1 within FULL_WEIGHT_KM of the Philippines, falling in a straight line to 0 at ZERO_WEIGHT_KM
const distanceWeight = (distanceKm) => {
  if (distanceKm <= FULL_WEIGHT_KM) return 1;
  if (distanceKm >= ZERO_WEIGHT_KM) return 0;
  return 1 - (distanceKm - FULL_WEIGHT_KM) / (ZERO_WEIGHT_KM - FULL_WEIGHT_KM);
};

// Shallow quakes do the most damage. An unknown depth counts as shallow.
const depthWeight = (depthKm) => {
  if (depthKm === null || depthKm === undefined || !Number.isFinite(Number(depthKm))) return 1;
  if (depthKm <= 70) return 1;
  if (depthKm <= 300) return 0.8;
  return 0.5;
};

// +25 per signed-in account with an approved report on the event, up to 20 accounts
const reportBonus = (reporters) => REPORT_POINTS * Math.min(Math.max(0, Number(reporters) || 0), MAX_REPORTERS);

const significanceScore = ({ magnitude, distanceKm, depthKm, reporters = 0 }) => (
  magnitudeTerm(magnitude) * distanceWeight(distanceKm) * depthWeight(depthKm) + reportBonus(reporters)
);

const isSignificant = (score) => score >= SIGNIFICANT_SCORE;

// Candidates [{ event, distanceKm, reporters }] -> the significant ones [{ event, score }]: highest score
// first, then newest, then publicID; at most MAX_SIGNIFICANT
function rankSignificant(candidates) {
  const time = (event) => new Date(event.OT).getTime() || 0;
  return candidates
    .map(({ event, distanceKm, reporters }) => ({
      event,
      score: significanceScore({
        magnitude: event.magnitude_value, distanceKm, depthKm: event.depth_value, reporters,
      }),
    }))
    .filter(({ score }) => isSignificant(score))
    .sort((a, b) => (b.score - a.score)
      || (time(b.event) - time(a.event))
      || String(a.event.publicID).localeCompare(String(b.event.publicID)))
    .slice(0, MAX_SIGNIFICANT);
}

// --- What the significant earthquakes pages show ---

// Values that mean "no place name" (as the events repository treats them)
const NO_PLACE = new Set(['', 'unavailable', 'unable to geocode', 'nominatim unavailable']);

// The event's place name, or its region text when it has none
const placeOf = (event) => {
  const place = typeof event.place === 'string' ? event.place.trim() : '';
  if (place && !NO_PLACE.has(place.toLowerCase())) return place;
  const region = typeof event.text === 'string' ? event.text.trim() : '';
  return region || null;
};

const magnitudeLabel = (magnitude) => Number(magnitude).toFixed(1);

// "M7.8 Earthquake, 24 km SW of Soccsksargen, Philippines"
const significantTitle = (event) => {
  const where = placeOf(event);
  return `M${magnitudeLabel(event.magnitude_value)} Earthquake${where ? `, ${where}` : ''}`;
};

const MANILA_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric',
});

// The summary admins wrote (the event's summaryOverride), or one built from the event:
// "A magnitude 7.8 earthquake struck 24 km SW of Soccsksargen, Philippines on June 7, 2026 at a depth of 10 km."
const significantSummary = (event) => {
  const written = event.summaryOverride && typeof event.summaryOverride.text === 'string'
    ? event.summaryOverride.text.trim() : '';
  if (written) return written;
  const where = placeOf(event);
  const time = new Date(event.OT);
  const depth = Number(event.depth_value);
  return [
    `A magnitude ${magnitudeLabel(event.magnitude_value)} earthquake`,
    where ? `struck ${where}` : 'occurred',
    Number.isFinite(time.getTime()) ? `on ${MANILA_DATE.format(time)}` : null,
    event.depth_value !== null && event.depth_value !== undefined && Number.isFinite(depth)
      ? `at a depth of ${Math.round(depth)} km` : null,
  ].filter(Boolean).join(' ').concat('.');
};

module.exports = {
  SIGNIFICANT_SCORE,
  MAX_SIGNIFICANT,
  ZERO_WEIGHT_KM,
  REPORT_POINTS,
  MAX_REPORTERS,
  PHILIPPINES_OUTLINE,
  PHILIPPINES_OUTLINE_WKT,
  magnitudeTerm,
  distanceWeight,
  depthWeight,
  reportBonus,
  significanceScore,
  isSignificant,
  rankSignificant,
  placeOf,
  significantTitle,
  significantSummary,
};
