const jwt = require('jsonwebtoken');

// Citizen role request sends tokens thru cookie in requests
function getTokenFromCookie(req, res, next) {
  if(!req.cookies) {
    res.status(403).json({ status: 403, message: "Cookies undefined" })
    return; // don't proceed to next()
  }

  const token = req.cookies.accessToken;
  if(!token) {
    res.status(403).json({ status: 403, message: "Token in cookie missing" })
    return;
  }

  req.token = token;
  next();
}

// Brgy & sensor roles' request send tokens thru Authorization Bearer in requests
function getTokenFromBearer(req, res, next) {
  const authHeader = req.headers["authorization"]
  if(!authHeader) {
    res.status(403).json({ status: 403, message: "Authorization Header Undefined" });
    return; // don't proceed to next()
  }

  const token = authHeader.split(" ")[1] // Authorization: "Bearer <token>"
  if(!token) {
    res.status(403).json({ status: 403, message: "Token in header missing" });
    return;
  }

  req.token = token;
  next();
}

// Verify token is valid, and role in token is role in arg
function verifyTokenWithRole(role) { // wrapper for custom args
  return (req, res, next) => {
    jwt.verify(req.token, process.env.ACCESS_TOKEN_PRIVATE_KEY, (err, decodedToken) => {

      if (err) {
        res.status(403).json({ status: 403, message: "Token invalid" });
        return;
      }

      if (decodedToken.role !== role) {
        res.status(403).json({ status: 403, message: "Role invalid" });
        return;
      }

      req.username = decodedToken.username;
      req.role = decodedToken.role;

      next();

    }) //end of jwt.verify()
  } // end of standard middleware
} // end of wrapper

module.exports = {
  getTokenFromCookie,
  getTokenFromBearer,
  verifyTokenWithRole
}
