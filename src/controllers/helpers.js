const jwt = require('jsonwebtoken');

function generateAccessToken(payload){
  return jwt.sign(
    payload, 
    process.env.ACCESS_TOKEN_PRIVATE_KEY, 
    {expiresIn: process.env.JWT_EXPIRY} // Adds 'exp' in seconds since epoch
  );
}

function formatErrorMessage(errorMessage) {
  return errorMessage
    .replace(/["\\]/g, "") // Strip double quotes and backslashes
    .replace(/^\w/, (c) => c.toUpperCase()); // Uppercase the first letter
}

module.exports = {
  generateAccessToken,
  formatErrorMessage,
}
