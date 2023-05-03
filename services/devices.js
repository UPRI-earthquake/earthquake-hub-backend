const Device = require('../models/device.model');
const Account = require('../models/account.model');

const addDevice = async (req, res) => {
  console.log("Add device requested");

  const username = req.body.username;

  try {
    const currentAccount = await Account.findOne({ username });

    if (!currentAccount) {
      throw Error('Username does not exist');
    }

    const newDevice = new Device({
      streamId: req.body.streamId,
      network: req.body.network,
      station: req.body.station,
      elevation: req.body.elevation,
      location: req.body.location,
      activity: req.body.activity,
      lastConnectedTime: req.body.lastConnectedTime
    });

    await newDevice.save();

    await currentAccount.updateOne({
      $inc: { devicesCount: 1 },
      $push: { devices: newDevice._id }
    });

    console.log(`Add device successful`);
    return res.status(200).json({ status: 200, message: "Succesfully Added Device" });
  } catch (e) {
    console.log(`Add device unsuccessful: \n ${e}`);
    return res.status(400).json({ status: 400, message: e.message });
  }
}

const linkDevice = async (req, res) => {
  console.log('Device Link Requested');

  try {
    console.log(req.body)
    const macAddress = req.body.macAddress;

    // check if macAddress input is null
    if (macAddress === null){
      res.status(400).json({ message: "Mac Address field cannot be null" }) // send 400 - null input
    }
    // check if device's mac address already exists in the database
    const deviceExists = await Device.exists({
      macAddress: macAddress
    })
    console.log(deviceExists)

    if (deviceExists) { // device is already saved to db
      // Send message to front end that device is already used
      res.status(400).json({ message: 'Device is Already Linked to an Existing Account' }) // send 400 - resource exists
    } else { // device is not yet used, proceed.
      // TODO: Authenticate user input. For now, chineck ko lang kung existing yung input username
      const username = req.body.username;
      const userExists = await Account.exists({
        username: username
      })
      console.log(userExists)

      if (userExists) { // user exists
        // Must be an existing user account to accept device linking request - update db. Create new document under `devices` collection
        const newDevice = new Device({
          streamId: null,
          network: null,
          station: null,
          location: null,
          elevation: null,
          macAddress: macAddress,
          lastConnectedTime: null
        })

        newDevice.save()
          .then(async (savedDoc) => {
            console.log('Save new entry to devices collection [ _id: ' + savedDoc._id + ' ]')
            const latestId = savedDoc._id // get the last _id inserted

            console.log(userExists.devices)

            //Update accounts collection
            let doc = await Account.findOne({username})
            doc.devices.push(latestId) // push last inserted _id of the device to devices array under accounts collection
            doc.save()

            console.log('Update accounts Collection Successful')
            res.status(200).json({ message: 'Device-Account Link Successful' })
          })
          .catch(err => {
            console.log(err)
            res.status(500).json(err)
          })

      } else { // user does not exists
        // send error - user does not exists
        res.status(400).json({ message: 'User Does Not Exists' })
      }
    }

  } catch (error) {
    console.log(error)
  }
}

module.exports = {
  addDevice,
  linkDevice
}