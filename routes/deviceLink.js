const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser')
const mongoose = require('mongoose');
const Devices = require('../models/devices');
const Accounts = require('../models/accounts');
const AccountDetails = require('../models/accountDetails');

router.use(bodyParser.json())

/* GET account information endpoint */
router.post('/', async(req, res) => {
    try {
        if(mongoose.connection.readyState === 1) { // connected to MongoDB
            console.log('Connected to MongoDB');
            console.log(req.body)

            const macAddress = req.body.macAddress;
            // check if device's mac address already exists in the database
            const deviceExists = await Devices.exists({
                macAddress: macAddress
            })
            console.log(deviceExists)

            if (deviceExists) { // device is already saved to db
                // Send message to front end that device is already used
                res.status(400).json({ message: 'Device is Already Linked to an Existing Account' }) // send 400 - resource exists
            } else { // device is not yet used
                // TODO: Authenticate user input. For now, chineck ko lang kung existing yung input username
                const username = req.body.accountName;
                const userExists = await Accounts.exists({
                    username: username
                })
                console.log(userExists)
                
                if (userExists) { // user exists
                    // Must be an existing user account to accept device linking request - update db. Create new document under `devices` collection
                    const newDevice = new Devices({ 
                        macAddress: macAddress,
                        status: "not connected"
                    })

                    newDevice.save()
                        .then(async(savedDoc) => {
                            console.log('Save new entry to devices collection - _id: ' + savedDoc._id)
                            const latestId = savedDoc._id // get the last _id inserted

                            // TODO: Update accounts collection
                            const filter = { account: userExists._id }
                            let doc = await AccountDetails.findOne(filter)
                            doc.devices.push(latestId) //
                            const update = { devices: doc.devices }
                            doc.save()

                            console.log('Update accountDetails Successful')
                            res.status(200).json({ message: 'Device-Account Link Successful' })
                        })
                        .catch( err => {
                            console.log(err)
                            res.status(500).json(err)
                        })
                        
                } else { // user does not exists
                    // TODO: send error - user does not exists
                    res.status(400).json({ message: 'User Does Not Exists'})
                }
            }
        }else{
            console.warn("MongoDB not connected");
            res.status(500).json({ message: 'MongoDB Connection Error'}) // send 500 - not connected to mongodb
        }

    } catch (error) {
        console.log(error)
    }
})

module.exports = router;
