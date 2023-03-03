import Account from '../models/account.js';

export const checkDuplicateUsernameOrEmail = async (req, res, next) => {
  const username = req.body.username;
  const email = req.body.email;

  console.log("Checking username and email from db");

  try {
    const checkUsername = await Account.findOne({ username });
    const checkEmail = await Account.findOne({ email });

    if (checkUsername) {
      res.status(400).json({ status: 400, message: "Register Account Unsuccessful. Username already exists!" });
      return;
    }

    if (checkEmail) {
      res.status(400).json({ status: 400, message: "Register Account Unsuccessful. Email already exists!" });
      return;
    }
    next();
  } catch (err) {
    console.log(`Error: ${err}`);
    res.status(400).json({ status: 400, message: err.message });
    return;
  }
}