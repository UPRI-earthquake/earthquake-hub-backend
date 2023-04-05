const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AccountSchema = new mongoose.Schema({
  email: String,
  username: String,
  password: String,
  roles: [String] // sensor, citizen, brgy
}, {

  timestamps: { //Mongoose automatic timestamps
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
});

module.exports = mongoose.model('Account', AccountSchema);
