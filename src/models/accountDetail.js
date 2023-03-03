import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const { Types } = Schema;

const AccountDetailSchema = new Schema({
  account: {
    type: Types.ObjectId,
    ref: 'Account'
  },
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

const AccountDetail = model('AccountDetail', AccountDetailSchema)

export default AccountDetail;