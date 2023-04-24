const mongoose = require('mongoose');

const {Schema} = mongoose;

const AccountDetailsSchema = new Schema({
  account: {type: Schema.Types.ObjectId, required: true},
  accountStatus: {type: Schema.Types.String, required: true},
  devices: {type: Schema.Types.Array, required: true},
  devicesCount: {type: Schema.Types.Number, required: true},
});

module.exports = mongoose.model('AccountDetails', AccountDetailsSchema)