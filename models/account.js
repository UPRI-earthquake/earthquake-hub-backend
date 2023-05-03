const mongoose = require('mongoose');

const { Schema, model } = mongoose;
const { Types } = Schema;

const AccountSchema = new Schema({
  username: String,
  email: String,
  password: String,
  accountStatus: {
    type: String,
    default: 'Inactive'
  },
  devices: [{
    type: Types.ObjectId,
    ref: 'Device'
  },],
})

module.exports = model('Account', AccountSchema);
