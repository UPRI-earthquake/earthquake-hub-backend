const bcrypt = require('bcryptjs');
const Account = require('../models/account.model');

const registerAccount = async (req, res) => {
  const hashedPassword = bcrypt.hashSync(req.body.password, 10);

  console.log("Create account requested");

  try {
    const newAccount = new Account({
      username: req.body.username,
      email: req.body.email,
      password: hashedPassword,
    });
    await newAccount.save();


    console.log(`Create account successful`);
    return res.status(200).json({ status: 200, message: "Succesfully Created Account" });
  } catch (e) {
    console.log(`Create account unsuccessful: \n ${e}`);
    return res.status(400).json({ status: 400, message: e.message });
  }
}

module.exports = {
  registerAccount
}
