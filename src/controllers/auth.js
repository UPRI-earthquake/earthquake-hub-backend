import bcrypt from 'bcryptjs';
import Account from '../models/account.js';
import AccountDetail from '../models/accountDetail.js';

export const registerAccount = async (req, res) => {
  const hashedPassword = bcrypt.hashSync(req.body.password, 10);

  console.log("Create account requested");

  try {
    const newAccount = new Account({
      username: req.body.username,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      password: hashedPassword
    });
    await newAccount.save();

    const newAccountDetail = new AccountDetail({
      account: newAccount._id,
    });

    await newAccountDetail.save();

    console.log(`Create account successful`);
    return res.status(200).json({ status: 200, message: "Succesfully Created Account" });
  } catch (e) {
    console.log(`Create account unsuccessful: \n ${e}`);
    return res.status(400).json({ status: 400, message: e.message });
  }
}