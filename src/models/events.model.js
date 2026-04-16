/**
 * @swagger
 * components:
 * schemas:
 * Event:
 * type: object
 * properties:
 * _id:
 * type: string
 * description: Auto-generated ObjectId
 * publicID:
 * type: string
 * description: Unique SeisComP public ID (Unique index enforced)
 * OT:
 * type: string
 * format: date-time
 * description: Origin time of the event
 * latitude_value:
 * type: number
 * longitude_value:
 * type: number
 * depth_value:
 * type: number
 * magnitude_value:
 * type: number
 * type:
 * type: string
 * description: Upstream eventType (e.g., NEW, UPDATE)
 * text:
 * type: string
 * description: SeisComP's derived place name
 * place:
 * type: string
 * description: Attribute added via Geoserve API
 * onlineStations:
 * type: array
 * items:
 * type: string
 * last_modification:
 * type: string
 * format: date-time
 * description: Used for deterministic conflict resolution
 * additionalInformation:
 * type: object
 * properties:
 * phivolcs:
 * $ref: '#/components/schemas/PhivolcsInfo'
 * usgs:
 * $ref: '#/components/schemas/UsgsInfo'
 * createdAt:
 * type: string
 * format: date-time
 * updatedAt:
 * type: string
 * format: date-time
 *
 * PhivolcsInfo:
 * type: object
 * properties:
 * source: { type: string }
 * dateTime: { type: string }
 * detailUrl: { type: string }
 * hasFeltIntensity: { type: boolean }
 * time: { type: string, format: date-time }
 * latitude: { type: number }
 * longitude: { type: number }
 * depthKm: { type: number }
 * magnitude: { type: number }
 * location: { type: string }
 * score: { type: number }
 *
 * UsgsInfo:
 * type: object
 * properties:
 * source: { type: string }
 * id: { type: string }
 * title: { type: string }
 * time: { type: string, format: date-time }
 * latitude: { type: number }
 * longitude: { type: number }
 * depth: { type: number }
 * magnitude: { type: number }
 * score: { type: number }
 */

const mongoose = require('mongoose');
// NOTE:
// - We persist the upstream SeisComP identifier in `publicID` and enforce
//   uniqueness so a single earthquake cannot be duplicated as multiple
//   documents (e.g., one "NEW" and one "UPDATE").
// - `type` stores the latest upstream eventType ("NEW" | "UPDATE").
// - `last_modification` is stored to allow deterministic conflict resolution
//   if multiple updates arrive out of order.
const eventSchema = new mongoose.Schema(
  {
    publicID: { type: String, required: true, index: true, unique: true },
    OT: Date,
    latitude_value: Number,
    longitude_value: Number,
    depth_value: Number,
    magnitude_value: Number,
    type: String, // upstream eventType
    text: String,
    place: String,
    onlineStations: [String],
    last_modification: Date,
    
    additionalInformation: {
      phivolcs: { 
        source: String,
        dateTime: String,
        detailUrl: String,
        hasFeltIntensity: Boolean,
        time: Date,
        latitude: Number,
        longitude: Number,
        depthKm: Number,
        magnitude: Number,
        location: String,
        distanceKm: Number,
        timeDifferenceMinutes: Number,
        magnitudeDifference: Number,
        score: Number
      },
      usgs: {
        source: String,
        id: String,
        title: String,
        place: String,
        url: String,
        detail: String,
        queryUrl: String,
        time: Date,
        latitude: Number,
        longitude: Number,
        depth: Number,
        magnitude: Number,
        distanceKm: Number,
        timeDifferenceMinutes: Number,
        magnitudeDifference: Number,
        latitudeFloorMatch: Boolean,
        longitudeFloorMatch: Boolean,
        score: Number
      }
    }
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
