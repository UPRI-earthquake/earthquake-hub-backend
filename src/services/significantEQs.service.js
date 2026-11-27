// Significant earthquakes: the events the significance score picks (src/services/significance.js), in
// the shape the frontend's Significant Earthquakes pages read, plus the details admins add to an event
// (its instrument recordings and references). The summary is the event's own summaryOverride.
const Joi = require('joi');
const EventsRepo = require('../repositories/events.repo');
const { rankSignificant, placeOf, significantTitle, significantSummary } = require('./significance');

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MAX_LIST_ITEMS = 50;

// One event as a card on the list page (and the top of the detail page)
const toCard = (event) => ({
  _id: event._id,
  publicID: event.publicID,
  title: significantTitle(event),
  magnitude: event.magnitude_value,
  depth: event.depth_value ?? null,
  location: placeOf(event),
  eventTime: event.OT,
  eventSummary: significantSummary(event),
});

/***************************************************************************
  * getAllSignificantEQs:
  *     The significant earthquakes: highest score first, at most 50. Each card also carries its
  *     score, rounded (significance).
  ***************************************************************************/
exports.getAllSignificantEQs = async () => {
  const candidates = await EventsRepo.listSignificanceCandidates();
  return rankSignificant(candidates).map(({ event, score }) => ({ ...toCard(event), significance: Math.round(score) }));
};

/***************************************************************************
  * getEarthquakeInfo:
  *     One event, by its `_id`, with its instrument recordings and references (empty lists when an
  *     admin added none). Any event can be opened this way, significant or not.
  *     Returns { str: 'invalidId' | 'notFound' | 'success', earthquakeInfo }.
  ***************************************************************************/
exports.getEarthquakeInfo = async (id) => {
  if (!OBJECT_ID.test(String(id ?? ''))) return { str: 'invalidId' };
  const ref = await EventsRepo.findRefById(id);
  if (!ref) return { str: 'notFound' };
  const [event, details] = await Promise.all([
    EventsRepo.findByPublicID(ref.publicID),
    EventsRepo.findSignificantDetails(id),
  ]);
  if (!event) return { str: 'notFound' };
  return {
    str: 'success',
    earthquakeInfo: {
      ...toCard(event),
      instrumentRecordings: details ? details.instrumentRecordings : [],
      references: details ? details.references : [],
    },
  };
};

// Station codes (as the detail page builds download links from them) and http(s) links
const detailsSchema = Joi.object({
  instrumentRecordings: Joi.array().max(MAX_LIST_ITEMS)
    .items(Joi.string().trim().uppercase().pattern(/^[A-Z0-9]{1,10}$/).messages({
      'string.pattern.base': 'Each instrument recording must be a station code (letters and digits, up to 10)',
    })),
  references: Joi.array().max(MAX_LIST_ITEMS)
    .items(Joi.string().trim().max(2000).uri({ scheme: ['http', 'https'] })),
}).or('instrumentRecordings', 'references').messages({
  'object.missing': 'Send instrumentRecordings, references, or both',
});

const unique = (list) => (list === undefined ? undefined : [...new Set(list)]);

/***************************************************************************
  * setDetails:
  *     Sets an event's instrument recordings and/or references; a list left out keeps its value.
  *     Returns { str: 'invalidId' | 'invalidDetails' (with message) | 'notFound' | 'success', details }.
  ***************************************************************************/
exports.setDetails = async (id, body, editedBy) => {
  if (!OBJECT_ID.test(String(id ?? ''))) return { str: 'invalidId' };
  const { error, value } = detailsSchema.validate(body || {}, { stripUnknown: true });
  if (error) return { str: 'invalidDetails', message: error.details[0].message };
  const details = await EventsRepo.setSignificantDetails(id, {
    instrumentRecordings: unique(value.instrumentRecordings),
    references: unique(value.references),
  }, editedBy);
  return details ? { str: 'success', details } : { str: 'notFound' };
};

/***************************************************************************
  * removeDetails:
  *     Removes an event's instrument recordings and references.
  *     Returns { str: 'invalidId' | 'notFound' | 'noDetails' | 'success' }.
  ***************************************************************************/
exports.removeDetails = async (id) => {
  if (!OBJECT_ID.test(String(id ?? ''))) return { str: 'invalidId' };
  const removed = await EventsRepo.removeSignificantDetails(id);
  if (removed === null) return { str: 'notFound' };
  return { str: removed ? 'success' : 'noDetails' };
};
