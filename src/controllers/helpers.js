const jwt = require('jsonwebtoken');

function generateAccessToken(payload){
  return jwt.sign(
    payload, 
    process.env.ACCESS_TOKEN_PRIVATE_KEY, 
    {expiresIn: process.env.JWT_EXPIRY} // Adds 'exp' in seconds since epoch
  );
}

function generateRefreshToken(payload){
  return jwt.sign(
    payload,
    process.env.REFRESH_TOKEN_PRIVATE_KEY || process.env.ACCESS_TOKEN_PRIVATE_KEY,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '90 days' }
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
  generateRefreshToken,
  formatErrorMessage,
  generateAMStationCode,
}
