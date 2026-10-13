/**
  * @swagger
  * components:
  *   schemas:
  *     Device:
  *       type: object
  *       properties:
  *         _id:
  *           type: string
  *           description: The auto-generated ObjectId of the device
  *         description:
  *           type: string
  *           description: The description of the device
  *         streamId:
  *           type: string
  *           description: The stream ID of the device (e.g. AM_RE722\.*\/MSEED)
  *           pattern: '^[A-Z]{2}_[A-Z0-9]{5}_\.\*\/MSEED$'
  *         network:
  *           type: string
  *           description: The network of the device
  *         station:
  *           type: string
  *           description: The station of the device
  *         latitude:
  *           type: number
  *           description: The latitude of the device
  *         longitude:
  *           type: number
  *           description: The longitude of the device
  *         elevation:
  *           type: number
  *           description: The elevation of the device
  *         macAddress:
  *           type: string
  *           description: The MAC address of the device
  *           pattern: '^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$'
  *         activity:
  *           type: string
  *           enum: [active, inactive, unlinked]
  *           description: The activity status of the device
  *         activityToggleTime:
  *           type: string
  *           format: date-time
  *           description: The time when the device's activity last changed
  */

const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const DeviceSchema = new Schema({
  description: {
    type: String
  },
  streamId: {
    type: String,
    default: null // null = not yet linked
  },
  network: {
    type: String,
    required:true
  },
  station: {
    type: String,
    required:true
  },
  latitude: {
    type: Number,
    required:true
  },
  longitude: {
    type: Number,
    required:true
  },
  elevation: {
    type: Number,
    required:true
  },
  macAddress: {
    type: String,
    default: null // null = not yet linked
  },
  activity: {
    type: String,
    enum: ['active', 'inactive', 'unlinked'],
    default: "inactive",
  },
  activityToggleTime: {
    type: Date,
    default: new Date(0),
  },
  rshakeAlertCredentialHash: {
    type: String,
    default: null,
  },
  rshakeAlertCredentialIssuedAt: {
    type: Date,
    default: null,
  }
}, { timestamps: true })

// Device identity is enforced by the database. streamId/macAddress are only unique
// when set, so any number of not-yet-linked (null) devices can exist.
// The filter is `$gt: ''` (any non-empty string) rather than `$type: 'string'` because the
// query planner only uses a partial index when the query implies its filter, and an
// equality lookup like { macAddress: 'aa:bb:..' } implies `$gt: ''` but not `$type`.
// Run scripts/find-duplicates.js before building these on an existing database.
DeviceSchema.index({ network: 1, station: 1 }, { unique: true });
DeviceSchema.index({ streamId: 1 }, { unique: true, partialFilterExpression: { streamId: { $gt: '' } } });
DeviceSchema.index({ macAddress: 1 }, { unique: true, partialFilterExpression: { macAddress: { $gt: '' } } });
DeviceSchema.index({ activity: 1 });

module.exports = model('Device', DeviceSchema);
