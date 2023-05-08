const Joi = require('joi');
const Device = require('../models/device.model');
const Account = require('../models/account.model');
const jwt = require('jsonwebtoken');

const addDeviceSchema = Joi.object().keys({
  network: Joi.string().required(),
  station: Joi.string().required(),
  elevation: Joi.string().required(),
  location: Joi.string().required()
});

const addDevice = async (req, res) => {
  console.log("Add device requested");

  const username = req.username; // this comes from cookie(token), not user input

  try {
    const result = addDeviceSchema.validate(req.body)
    if(result.error){
      // TODO: know more details on which input is invalid...
      res.status(400).json({ status: 400, message: `Invalid input: ${result.error}`});
      return;
    }

    const currentAccount = await Account.findOne({ username }); //check if account exists in the database
    if (!currentAccount) {
      // throw Error('Username does not exist');
      res.status(400).json({ status: 400, message: 'Username does not exists'});
      return;
    }

    // check if user inputs are not yet saved in the database
    const deviceDetailsCheck = await Device.findOne({
      network: req.body.network,
      station: req.body.station,
      elevation: req.body.elevation,
      location: req.body.location
    });
    if (deviceDetailsCheck) {
      // throw Error('Username does not exist');
      res.status(400).json({ status: 400, message: 'Device details already used'});
      return;
    }

    const newDevice = new Device({
      network: req.body.network,
      station: req.body.station,
      elevation: req.body.elevation,
      location: req.body.location,
    });
    await newDevice.save(); // save new entry to device collections

    await currentAccount.updateOne({ // update devices array under accounts collection
      $push: { devices: newDevice._id }
    });

    console.log(`Add device successful`);
    return res.status(200).json({ status: 200, message: "Succesfully Added Device" });
  } catch (e) {
    console.log(`Add device unsuccessful: \n ${e}`);
    return res.status(400).json({ status: 400, message: e.message });
  }
}

const linkDeviceSchema = Joi.object().keys({
  token: Joi.string().regex(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/).required(),
  macAddress: Joi.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/).required(),
  streamId: Joi.string().regex(/^[A-Z]{2}_[A-Z0-9]{5}_[0-9]{2}_[A-Z]{3}(,[A-Z]{2}_[A-Z0-9]{5}_[0-9]{2}_[A-Z]{3})*$/).required()

});

const linkDevice = async (req, res) => {
  console.log('Device Link Requested');

  try {
    const result = linkDeviceSchema.validate(req.body)
     if(result.error){
      // TODO: know more details on which input is invalid...
      res.status(400).json({ status: 400, message: `Invalid input: ${result.error}`});
      return;
    }

    // check if device's mac address already exists in the database
    const deviceExists = await Device.exists({
      macAddress: result.value.macAddress
    })

    if (deviceExists) { // device is already saved to db
      // Send message to front end that device is already used
      res.status(400).json({ message: 'Device is Already Linked to an Existing Account' }) // send 400 - resource exists
      return;
    }

    // TODO: Authenticate user input. For now, chineck ko lang kung existing yung input username
    const username = "citizen" // this should come from verify(token)
    const user = await Account.findOne({ 'username': username }).populate('devices')

    if (!user) { // user exists
      res.status(400).json({ message: 'User Does Not Exists' })
      return;

    }

    // Must be an existing user account to accept device linking request - update db.
    // get device with same Network and Station
    const [network, station, loc, channel] = result.value.streamId.split(",")[0].split("_")
    const device = await Device.findOne({ network:network, station:station })

    if(!device){
      res.status(400).json({ status: 400, message: "Device doesn't exist in the database!"});
      return;
    }

    // find the index of the device in the user.devices array
    const index = user.devices.findIndex(dev => dev.id === device.id);

    if (index === -1) {
      // device not found in the account.devices array, handle error or return null
      res.status(400).json({ status: 400, message: "Device is not yet added to user's device list"});
      return;
    }

    //Update device info
    device.macAddress = result.value.macAddress
    device.streamId = result.value.streamId
    device.save()

    console.log("Update account's device successful")
    res.status(200).json({ message: 'Device-Account Linking Successful' })

  } catch (error) {
    next(error)
  }
}

module.exports = {
  addDevice: [getCitizenToken, verifyTokenRole('citizen'), addDevice],
  linkDevice
}
