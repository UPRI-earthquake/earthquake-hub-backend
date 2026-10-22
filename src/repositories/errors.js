// Errors repositories throw in place of database-specific ones, so services handle them the same way
// whichever database backs an area.

// A write broke a unique rule. `fields` names what collided (e.g. ['email']).
class DuplicateKeyError extends Error {
  constructor(fields = []) {
    super(`Duplicate value for ${fields.join(', ') || 'a unique field'}`);
    this.name = 'DuplicateKeyError';
    this.fields = fields;
  }
}

// MongoDB's E11000 as a DuplicateKeyError; any other error is returned unchanged
const fromMongoError = (err) => (
  err?.code === 11000 ? new DuplicateKeyError(Object.keys(err.keyPattern || err.keyValue || {})) : err
);

module.exports = {
  DuplicateKeyError,
  fromMongoError,
};
