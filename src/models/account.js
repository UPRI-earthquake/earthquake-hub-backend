import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const AccountSchema = new Schema({
  username: String,
  firstName: String,
  lastName: String,
  email: String,
  password: String
})

const Account = model('Account', AccountSchema)

export default Account;
