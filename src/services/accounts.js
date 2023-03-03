import Account from '../models/account.js';

export const getAccountFromDb = async function (query) {
  try {
    const account = await Account.find(query);
    return account;
  } catch (e) {
    throw Error(e)
  }
}