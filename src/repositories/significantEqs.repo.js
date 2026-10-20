// Data access for hand-curated significant earthquakes. Services use these functions instead of the
// Mongoose model, so the storage (MongoDB today, PostgreSQL later) can change without touching them.
//
// Records are returned in the shape the API sends (`_id`, field names as stored), so a later storage
// switch has to map back to this shape. __tests__/golden/ holds the recorded responses to check against.
const { Types } = require('mongoose');
const SignificantEQs = require('../models/significantEQ.model');

// Whether `id` has the format of a record id (lets the API tell "invalid id" from "not found")
const isValidId = (id) => Types.ObjectId.isValid(id);

const findAll = async () => SignificantEQs.find({}).lean();

// Resolves to null when no record has this id
const findById = async (id) => SignificantEQs.findById(id).lean();

module.exports = {
  isValidId,
  findAll,
  findById,
};
