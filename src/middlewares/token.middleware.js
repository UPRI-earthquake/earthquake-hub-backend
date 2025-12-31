const jwt = require('jsonwebtoken');
const {responseCodes} = require('../controllers/responseCodes')

// Citizen role request sends tokens thru cookie in requests
function getTokenFromCookie(req, res, next) {
  if(!req.cookies) {
    res.status(403).json({ status: 403, message: "Cookies undefined" })
    return; // don't proceed to next()
  }

  const token = req.cookies.accessToken;
  req.refreshToken = req.cookies.refreshToken;
  if(!token) {
    res.status(403).json({ status: 403, message: "Token in cookie missing" })
    return;
  }

  req.token = token;
  next();
}

// Optional cookie reader: does not error when cookie/token is missing
function getTokenFromCookieIfPresent(req, res, next) {
  // Normalize flags used by optional verifiers
  req.isAuthenticated = false;
  req.sessionError = null;
  req.refreshToken = req.cookies ? req.cookies.refreshToken : undefined;

  // If cookies are unavailable or token not present, proceed without setting req.token
  if (!req.cookies || !req.cookies.accessToken) {
    return next();
  }

  req.token = req.cookies.accessToken;
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
function verifyTokenWithRole(role, ignoreExpiration = false) { // wrapper for custom args
  const allowedRoles = Array.isArray(role) ? role : [role];
  return (req, res, next) => {
    jwt.verify(req.token, 
      process.env.ACCESS_TOKEN_PRIVATE_KEY, 
      {ignoreExpiration: ignoreExpiration}, 
      (err, decodedToken) => {

      if (err) {
        if (err.name == 'JsonWebTokenError'){
          res.status(403).json({
            status: responseCodes.VERIFICATION_INVALID_TOKEN,
            message: "Token invalid"
          });
        } else if (err.name == 'TokenExpiredError'){
          res.status(403).json({
            status: responseCodes.VERIFICATION_EXPIRED_TOKEN,
            message: "Token expired"
          });
        }
        return;
      }

      if (!allowedRoles.includes(decodedToken.role)) {
        res.status(403).json({
          status: responseCodes.VERIFICATION_INVALID_ROLE,
          message: "Role invalid"
        });
        return;
      }

      req.username = decodedToken.username;
      req.role = decodedToken.role;
      req.tokenExpiry = decodedToken.exp;
      if (decodedToken.streamIds) { // for roles of brgy & sensor
        req.streamIds = decodedToken.streamIds;
      }
      next();

    }) //end of jwt.verify()
  } // end of standard middleware
} // end of wrapper

// Verify token with role but do not error; sets req.isAuthenticated=false on failures
function verifyTokenWithRoleOptional(role, ignoreExpiration = false) {
  const allowedRoles = Array.isArray(role) ? role : [role];
  return (req, res, next) => {
    // If no token provided, skip verification; treat as unauthenticated
    if (!req.token) {
      req.isAuthenticated = false;
      req.sessionError = req.sessionError || 'missing';
      return next();
    }

    jwt.verify(
      req.token,
      process.env.ACCESS_TOKEN_PRIVATE_KEY,
      { ignoreExpiration },
      (err, decodedToken) => {
        if (err) {
          // Invalid or expired token — treat as unauthenticated without responding
          req.isAuthenticated = false;
          req.sessionError = err.name === 'TokenExpiredError' ? 'expired' : 'invalid';
          return next();
        }

        if (!allowedRoles.includes(decodedToken.role)) {
          // Role mismatch — treat as unauthenticated without responding
          req.isAuthenticated = false;
          req.sessionError = 'invalidRole';
          return next();
        }

        // Valid token and role
        req.username = decodedToken.username;
        req.role = decodedToken.role;
        req.tokenExpiry = decodedToken.exp;
        if (decodedToken.streamIds) {
          req.streamIds = decodedToken.streamIds;
        }
        req.isAuthenticated = true;
        req.sessionError = null;
        next();
      }
    );
  };
}

module.exports = {
  getTokenFromCookie,
  getTokenFromCookieIfPresent,
  getTokenFromBearer,
  verifyTokenWithRole,
  verifyTokenWithRoleOptional,
}
