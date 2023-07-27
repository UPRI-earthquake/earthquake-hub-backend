const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  email: String,
  username: String,
  password: String,
  roles: [String], // sensor, citizen, brgy, admin
  accountStatus: { // inactive, active
    type: String,
    default: 'inactive'
  },
  devices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device'
  },],
}, {

  timestamps: { //Mongoose automatic timestamps
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
});

module.exports = mongoose.model('Account', AccountSchema);
