const Device = require('../models/device');
const Account = require('../models/account');

const addDevice = async (req, res) => {
  console.log("Add device requested");
  
  const username = req.body.username;

  try {
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

    await Account.findOneAndUpdate({ username }, {
      $push: { devices: newDevice._id}
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