const jwt = require('jsonwebtoken');

function generateAccessToken(payload){
  return jwt.sign(
    payload, 
    process.env.ACCESS_TOKEN_PRIVATE_KEY, 
    {expiresIn: process.env.JWT_EXPIRY} // Adds 'exp' in seconds since epoch
  );
}

function _test_generateAccessToken(payload, expiry){
  return jwt.sign(
    payload, 
    process.env.ACCESS_TOKEN_PRIVATE_KEY, 
    {expiresIn: expiry} // Adds 'exp' in seconds since epoch
  );
}

function formatErrorMessage(errorMessage) {
  return errorMessage
    .replace(/["\\]/g, "") // Strip double quotes and backslashes
    .replace(/^\w/, (c) => c.toUpperCase()); // Uppercase the first letter
}

function generateAMStationCode(macAddress) {
  // Remove any colons from the MAC address
  const cleanMacAddress = macAddress.replace(/:/g, '').toUpperCase();

  // Extract the last 4 characters and prepend 'R'
  const stationCode = 'R' + cleanMacAddress.slice(-4);

  return stationCode;
}

module.exports = {
  generateAccessToken,
  formatErrorMessage,
  generateAMStationCode,
  _test_generateAccessToken
}
