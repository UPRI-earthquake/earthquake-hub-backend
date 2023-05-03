const Device = require('../models/device');
const Account = require('../models/account.model');

const addDevice = async (req, res) => {
  console.log("Add device requested");
  
  const username = req.body.username;

  try {
    const currentAccount = await Account.findOne({ username }); 

    if(!currentAccount) {
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
  } catch(e){
    console.log(`Add device unsuccessful: \n ${e}`);
    return res.status(400).json({ status: 400, message: e.message });
  }
}

module.exports = {
  addDevice
}
