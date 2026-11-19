const mongoose = require('mongoose');

const {Schema} = mongoose;

const SubscriptionSchema = new Schema({
  endpoint: {type: Schema.Types.String, unique: true, required: true},
  expirationTime: {type: Schema.Types.Number, required: false},
  keys: {
    auth: {type: Schema.Types.String, required: true},
    p256dh: {type: Schema.Types.String, required: true}, 
  },
  status: {
    type: Schema.Types.String,
    enum: ['active', 'invalid'],
    default: 'active',
    index: true,
  },
  lastSeenAt: {
    type: Schema.Types.Date,
    default: Date.now,
    index: true,
  },
  lastDeliveredAt: { type: Schema.Types.Date, required: false },
  lastFailureAt: { type: Schema.Types.Date, required: false },
  lastFailureCode: { type: Schema.Types.Number, required: false },
  consecutiveFailures: {
    type: Schema.Types.Number,
    default: 0,
    min: 0,
  },
  invalidatedAt: { type: Schema.Types.Date, required: false },
  cleanupAfter: { type: Schema.Types.Date, required: false },
  sourceSwScript: { type: Schema.Types.String, required: false },
  clientMeta: {
    userAgent: { type: Schema.Types.String, required: false },
    appVersion: { type: Schema.Types.String, required: false },
    clientTime: { type: Schema.Types.Date, required: false },
  },
}, {
  timestamps: true,
});

SubscriptionSchema.index({ status: 1, lastSeenAt: 1, consecutiveFailures: 1 });
// TTL-backed hard cleanup; documents are removed once cleanupAfter is in the past.
SubscriptionSchema.index({ cleanupAfter: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Subscription', SubscriptionSchema)

