const responseCodes = {
  /* Status Code Format: XYZ 
   * X : 0 if success type, 1 if error type
   * Y : 0-n based on group of response (ie REGISTRATION is 1, AUTH is 2, and so on)
   * Z : 0-n increments as type changes within a group of response
   * 
   * For example:
   * 123 :
   * 1 = Error type of code
   * 2 = Authentication group
   * 3 = 3rd type of error within authentication group 
   */

  GENERIC_SUCCESS: 0,
  GENERIC_ERROR: 100,
  VALIDATION_ERROR: 101,                            

  REGISTRATION_SUCCESS:                 10,
  REGISTRATION_ERROR:                   110,
  REGISTRATION_USERNAME_IN_USE:         111,
  REGISTRATION_EMAIL_IN_USE:            112,
  REGISTRATION_RINGSERVER_URL_IN_USE:   113,

  AUTHENTICATION_SUCCESS:           20,
  AUTHENTICATION_TOKEN_COOKIE:      21,
  AUTHENTICATION_TOKEN_PAYLOAD:     22,
  AUTHENTICATION_SESSION_REFRESHED: 23,
  AUTHENTICATION_ERROR:            120,
  AUTHENTICATION_USER_NOT_EXIST:   121,
  AUTHENTICATION_INVALID_ROLE:     122,
  AUTHENTICATION_WRONG_PASSWORD:   123,
  AUTHENTICATION_NO_LINKED_DEVICE: 124,
  AUTHENTICATION_ACCOUNT_INACTIVE: 125,
  AUTHENTICATION_SESSION_EXPIRED:  126,
  AUTHENTICATION_INVALID_CREDENTIALS: 127,

  VERIFICATION_SUCCESS:            30,
  VERIFICATION_SUCCESS_NEW_TOKEN:  31,
  VERIFICATION_ERROR:             130,
  VERIFICATION_INVALID_TOKEN:     131,
  VERIFICATION_INVALID_ROLE:      132,
  VERIFICATION_EXPIRED_TOKEN:     133,

  INBEHALF_VERIFICATION_SUCCESS:            40,
  INBEHALF_VERIFICATION_ERROR:             140,
  INBEHALF_VERIFICATION_INVALID_TOKEN:     141,
  INBEHALF_VERIFICATION_INVALID_ROLE:      142,
  INBEHALF_VERIFICATION_EXPIRED_TOKEN:     143,

  SIGNOUT_SUCCESS:   50,
  SIGNOUT_ERROR:    150,

  LINKING_SUCCESS:            60,
  LINKING_ALREADY_DONE:       61,
  LINK_RESET_SUCCESS:         62,
  LINK_RESET_ERROR:          162,

  TUNNEL_ENROLL_SUCCESS:      80,
  TUNNEL_LIST_SUCCESS:        81,
  TUNNEL_REVOKE_SUCCESS:      82,
  REMOTE_ACTION_CAPABILITIES_SUCCESS: 83,
  REMOTE_ACTION_EXECUTE_SUCCESS: 84,
  REMOTE_ACTION_SERVERS_SUCCESS: 85,
  TUNNEL_ENROLL_ERROR:       190,
  TUNNEL_ENROLL_COLLISION:   191,
  TUNNEL_LIST_ERROR:         192,
  TUNNEL_REVOKE_ERROR:       193,
  REMOTE_ACTION_CAPABILITIES_ERROR: 194,
  REMOTE_ACTION_EXECUTE_ERROR: 195,
  REMOTE_ACTION_SERVERS_ERROR: 196,

  PASSWORD_RESET_REQUESTED:   70,
  PASSWORD_RESET_SUCCESS:     71,
  PASSWORD_RESET_INVALID:    170,
  PASSWORD_RESET_EXPIRED:    171,
  PASSWORD_RESET_USER_MISSING:172,
  ACCOUNT_DELETE_HAS_DEVICES: 180,
};

const responseMessages = {
  GENERIC_SUCCESS: "Success",
  GENERIC_ERROR: "Error",
  VALIDATION_ERROR: "Input string failed validation",                            

  REGISTRATION_SUCCESS: "Registration success",
  REGISTRATION_ERROR: "Registration error",
  REGISTRATION_USERNAME_IN_USE: "Registration error: Username already in use",
  REGISTRATION_EMAIL_IN_USE: "Registration error: Email already in use",

  AUTHENTICATION_SUCCESS: "Authentication success",
  AUTHENTICATION_TOKEN_COOKIE: "Authentication success: Token in cookie",
  AUTHENTICATION_TOKEN_PAYLOAD: "Authentication success: Token in payload",
  AUTHENTICATION_SESSION_REFRESHED: "Authentication success: Session refreshed",
  AUTHENTICATION_ERROR: "Authentication error",
  AUTHENTICATION_USER_NOT_EXIST: "Authentication error: User doesn't exist",
  AUTHENTICATION_INVALID_ROLE: "Authentication error: Invalid role claimed",
  AUTHENTICATION_WRONG_PASSWORD: "Authentication error: Wrong password",
  AUTHENTICATION_NO_LINKED_DEVICE: "Authentication error: Account has no linked/forwardable devices",
  AUTHENTICATION_SESSION_EXPIRED: "Authentication error: Session expired",
  AUTHENTICATION_INVALID_CREDENTIALS: "Authentication error: Invalid credentials",

  VERIFICATION_SUCCESS: "Verification success",
  VERIFICATION_SUCCESS_NEW_TOKEN: "Verification success with new token",
  VERIFICATION_ERROR: "Verification error",
  VERIFICATION_INVALID_TOKEN: "Verification error: Invalid token",
  VERIFICATION_INVALID_ROLE: "Verification error: Invalid role in token",
  VERIFICATION_EXPIRED_TOKEN: "Verification error: Expired token",

  PASSWORD_RESET_REQUESTED: "Password reset requested",
  PASSWORD_RESET_SUCCESS: "Password reset success",
  PASSWORD_RESET_INVALID: "Password reset error: Invalid token",
  PASSWORD_RESET_EXPIRED: "Password reset error: Expired token",
  PASSWORD_RESET_USER_MISSING: "Password reset error: User not found",
  ACCOUNT_DELETE_HAS_DEVICES: "Account deletion blocked: Devices are still linked",
  LINK_RESET_SUCCESS: "Device link reset",
  LINK_RESET_ERROR: "Device link reset error",
  TUNNEL_ENROLL_SUCCESS: "Device tunnel enrollment success",
  TUNNEL_LIST_SUCCESS: "Device tunnel mapping list success",
  TUNNEL_REVOKE_SUCCESS: "Device tunnel revoke success",
  REMOTE_ACTION_CAPABILITIES_SUCCESS: "Remote action capabilities success",
  REMOTE_ACTION_EXECUTE_SUCCESS: "Remote action execute success",
  REMOTE_ACTION_SERVERS_SUCCESS: "Remote action servers success",
  TUNNEL_ENROLL_ERROR: "Device tunnel enrollment error",
  TUNNEL_ENROLL_COLLISION: "Device tunnel enrollment collision",
  TUNNEL_LIST_ERROR: "Device tunnel mapping list error",
  TUNNEL_REVOKE_ERROR: "Device tunnel revoke error",
  REMOTE_ACTION_CAPABILITIES_ERROR: "Remote action capabilities error",
  REMOTE_ACTION_EXECUTE_ERROR: "Remote action execute error",
  REMOTE_ACTION_SERVERS_ERROR: "Remote action servers error",
};

module.exports = {
  responseCodes,
  responseMessages,
};
