const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const AccountSchema = new Schema({
  username: String,
  firstName: String,
  lastName: String,
  email: String,
  password: String
})

module.exports = model('Account', AccountSchema)

