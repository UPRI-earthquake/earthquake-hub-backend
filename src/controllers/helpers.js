const jwt = require('jsonwebtoken');

function generateAccessToken(payload){
  return jwt.sign(
    payload, 
    process.env.ACCESS_TOKEN_PRIVATE_KEY, 
    {expiresIn: process.env.JWT_EXPIRY} // Adds 'exp' in seconds since epoch
  );
}

module.exports = {
  generateAccessToken,
}

