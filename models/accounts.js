const mongoose = require('mongoose');

const {Schema} = mongoose;

const AccountsSchema = new Schema({
  email: {type: Schema.Types.String, required: true},
  firstName: {type: Schema.Types.String, required: true},
  lastName: {type: Schema.Types.String, required: true},
  password: {type: Schema.Types.String, required: true},
  username: {type: Schema.Types.String, required: true},
});

module.exports = mongoose.model('Accounts', AccountsSchema)