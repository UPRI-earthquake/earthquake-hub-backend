const mongoose = require('mongoose');

const { Schema, Types, model } = mongoose;

const AccountSchema = new Schema({
  username: String,
  email: String,
  password: String,
  accountStatus: {
    type: String,
    default: 'Inactive'
  },
  devicesCount: {
    type: Number,
    default: 0
  },
  devices: [{
    type: Types.ObjectId,
    ref: 'Device'
  },],
})

module.exports = model('Account', AccountSchema)

