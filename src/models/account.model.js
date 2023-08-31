/**
  * @swagger
  * components:
  *   schemas:
  *     Account:
  *       type: object
  *       properties:
  *         _id:
  *           type: string
  *           description: The auto-generated ObjectId of the account
  *         email:
  *           type: string
  *           description: The email address of the account
  *         username:
  *           type: string
  *           description: The username of the account
  *         password:
  *           type: string
  *           description: The password of the account
  *         accountStatus:
  *           type: string
  *           description: The status of the account
  *           enum:
  *             - Inactive
  *             - Active
  *         roles:
  *           type: array
  *           items:
  *             type: string
  *           description: The roles associated with the account 
  *           enum:
  *             - sensor  # 'sensor' is for when authenticating from rshake device
  *             - citizen # 'citizen' is for when authenticating from webapp frontend
  *             - admin   # 'admin' is for when authenticating from webapp admin-frontend
  *             - brgy    # 'brgy' is for when requesting authentication from ringserver
  *         devices:
  *           type: array
  *           items:
  *             type: objectId
  *           description: The devices associated with the account
  *       example:
  *         _id: 6151ec04b417ad001ff7d343
  *         email: test@gmail.com
  *         username: testuser
  *         password: testpassword
  *         roles:
  *           - sensor
  *           - citizen
  *         accountStatus: inactive
  *         devices:
  *           - 6151ec04b417ad001ff7d345
  *           - 6151ec04b417ad001ff7d346
  *     
  */

const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  email: String,
  username: String,
  password: String,
  roles: [String], // sensor, citizen, brgy, admin
  isApproved: { // inactive, active
    type: Boolean,
    default: false
  },
  devices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device'
  },],
  ringserverUrl: String,
  ringserverPort: Number,
}, {

  timestamps: { //Mongoose automatic timestamps
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
});

module.exports = mongoose.model('Account', AccountSchema);
