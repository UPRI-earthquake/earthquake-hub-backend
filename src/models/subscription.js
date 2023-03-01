import mongoose from 'mongoose';

const { Schema } = mongoose;

const SubscriptionSchema = new Schema({
  endpoint: { type: Schema.Types.String, unique: true, required: true },
  expirationTime: { type: Schema.Types.Number, required: false },
  keys: {
    auth: { type: Schema.Types.String, required: true },
    p256dh: { type: Schema.Types.String, required: true },
  },
});

export default mongoose.model('Subscription', SubscriptionSchema);


