import mongoose from 'mongoose';

const { Schema, ObjectId, model } = mongoose;

export const DeviceSchema = new Schema({
  streamId: String,
  location: String,
  activity: String,
  lastConnectedTime: String
})

const Device = model('Device', DeviceSchema)

export default Device;
