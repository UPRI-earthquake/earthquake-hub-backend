const mongoose = require('mongoose');

const {Schema} = mongoose;

const DevicesSchema = new Schema({
  // streamId: {type: Schema.Types.ObjectId, required: true},
  macAddress: {type: Schema.Types.String, required: true},
  status: {type: Schema.Types.String, required: true},
  // location: {type: Schema.Types.String, required: true},
  // activity: {type: Schema.Types.String, required: true},
  // lastConnectedTime: {type: Schema.Types.String, required: true},
});

module.exports = mongoose.model('Devices', DevicesSchema)