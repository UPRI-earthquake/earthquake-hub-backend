/**
 * @swagger
 *   components:
 *     schemas:
 *       Event:
 *         type: object
 *         properties:
 *           _id:
 *             type: string
 *             description: Auto-generated ObjectId
 *           publicID:
 *             type: string
 *             description: Unique SeisComP public ID (unique index enforced)
 *           OT:
 *             type: string
 *             format: date-time
 *             description: Origin time of the event
 *           latitude_value:
 *             type: number
 *           longitude_value:
 *             type: number
 *           depth_value:
 *             type: number
 *           magnitude_value:
 *             type: number
 *           type:
 *             type: string
 *             description: Upstream event type such as NEW or UPDATE
 *           text:
 *             type: string
 *             description: SeisComP derived place name
 *           place:
 *             type: string
 *             description: Place attribute added via the Geoserve API
 *           onlineStations:
 *             type: array
 *             items:
 *               type: string
 *           last_modification:
 *             type: string
 *             format: date-time
 *             description: Used for deterministic conflict resolution
 *           upForEnrichment:
 *             type: boolean
 *             description: >
 *               True while the event has not yet been enriched with
 *               additionalInformation. Set to false once enrichment succeeds
 *               or enrichmentAttempts reaches MAX_ENRICHMENT_ATTEMPTS.
 *           enrichmentAttempts:
 *             type: integer
 *             description: >
 *               Number of times the enrichment job has attempted to process
 *               this event. Prevents indefinite retries on persistent failures.
*           summaryOverride:
 *             type: object
 *             nullable: true
 *             properties:
 *               text:
 *                 type: string
 *                 description: The user-edited summary text, overrides the auto-generated boilerplate.
 *               editedAt:
 *                 type: string
 *                 format: date-time
 *                 description: Timestamp of when the summary was last edited.
 *               editedBy:
 *                 type: string
 *                 description: The userId or username of the person who edited the summary.
 *           additionalInformation:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/CatalogSourceInfo'
 *           pendingCatalogSources:
 *             type: array
 *             items:
 *               type: string
 *           catalogEnrichmentAttempts:
 *             type: object
 *             additionalProperties:
 *               type: number
 *           catalogEnrichmentStatus:
 *             type: object
 *             additionalProperties:
 *               type: string
 *           createdAt:
 *             type: string
 *             format: date-time
 *           updatedAt:
 *             type: string
 *             format: date-time
 *
 *       CatalogSourceInfo:
 *         type: object
 *         properties:
 *           source:
 *             type: string
 *           sourceLabel:
 *             type: string
 *           sourceIconUrl:
 *             type: string
 *           dateTime:
 *             type: string
 *           detailUrl:
 *             type: string
 *           hasFeltIntensity:
 *             type: boolean
 *           id:
 *             type: string
 *           title:
 *             type: string
 *           place:
 *             type: string
 *           url:
 *             type: string
 *           detail:
 *             type: string
 *           queryUrl:
 *             type: string
 *           time:
 *             type: string
 *             format: date-time
 *           latitude:
 *             type: number
 *           longitude:
 *             type: number
 *           depthKm:
 *             type: number
 *           depth:
 *             type: number
 *           magnitude:
 *             type: number
 *           location:
 *             type: string
 *           distanceKm:
 *             type: number
 *           timeDifferenceMinutes:
 *             type: number
 *           magnitudeDifference:
 *             type: number
 *           score:
 *             type: number
 *           matchQuality:
 *             type: string
 *             enum: [high, medium, low]
 *           latitudeFloorMatch:
 *             type: boolean
 *           longitudeFloorMatch:
 *             type: boolean
 */

const mongoose = require('mongoose');

const catalogSourceSchema = new mongoose.Schema(
  {
    source:                 { type: String, required: true },
    sourceLabel:            String,
    sourceIconUrl:          String,
    dateTime:               String,
    detailUrl:              String,
    hasFeltIntensity:       Boolean,
    id:                     String,
    title:                  String,
    place:                  String,
    url:                    String,
    detail:                 String,
    queryUrl:               String,
    time:                   Date,
    latitude:               Number,
    longitude:              Number,
    depth:                  Number,
    depthKm:                Number,
    magnitude:              Number,
    location:               String,
    distanceKm:             Number,
    timeDifferenceMinutes:  Number,
    magnitudeDifference:    Number,
    latitudeFloorMatch:     Boolean,
    longitudeFloorMatch:    Boolean,
    score:                  Number,
    matchQuality:           String,
    raw:                    mongoose.Schema.Types.Mixed,
  },
  { _id: false, strict: false },
);

const summaryOverrideSchema = new mongoose.Schema(
  {
    text:     { type: String, required: true }, // the edited content
    editedAt: { type: Date,   default: Date.now },
    editedBy: { type: String },                 // userId/username if you have auth
  },
  { _id: false },
);

// NOTE:
// - We persist the upstream SeisComP identifier in `publicID` and enforce
//   uniqueness so a single earthquake cannot be duplicated as multiple
//   documents (e.g., one "NEW" and one "UPDATE").
// - `type` stores the latest upstream eventType ("NEW" | "UPDATE").
// - `last_modification` is stored to allow deterministic conflict resolution
//   if multiple updates arrive out of order.
// - `upForEnrichment` is set to true on insert and cleared to false once the
//   enrichment job successfully writes additionalInformation (or the event
//   exhausts MAX_ENRICHMENT_ATTEMPTS).
// - `enrichmentAttempts` is incremented on every enrichment job pass so the
//   job can give up after a configurable number of persistent failures.
const eventSchema = new mongoose.Schema(
  {
    publicID:         { type: String, required: true, index: true, unique: true },
    OT:               Date,
    latitude_value:   Number,
    longitude_value:  Number,
    depth_value:      Number,
    magnitude_value:  Number,
    type:             String,   // upstream eventType
    text:             String,
    place:            String,
    onlineStations:   [String],
    last_modification: Date,

    summaryOverride: { type: summaryOverrideSchema, default: null },

    // Legacy global enrichment tracking. Kept for existing records and old
    // operational scripts; new scraper logic uses source-level tracking below.
    upForEnrichment:    { type: Boolean, default: true, index: true },
    enrichmentAttempts: { type: Number,  default: 0 },

    additionalInformation:      { type: [catalogSourceSchema], default: [] },
    pendingCatalogSources:      { type: [String], default: ['phivolcs', 'usgs'], index: true },
    catalogEnrichmentAttempts:  { type: Map, of: Number, default: {} },
    catalogEnrichmentStatus:    { type: Map, of: String, default: {} },

  },
  {
    timestamps: true, // createdAt/updatedAt for troubleshooting
  },
);

// In case the collection already exists without the unique index, Mongoose
// will attempt to create it on startup. If duplicates are present, index
// creation will fail; clean duplicates first then re-create the index.
eventSchema.index({ publicID: 1 }, { unique: true });

module.exports = mongoose.model('Event', eventSchema);
