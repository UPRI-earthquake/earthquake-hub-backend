// Significant earthquakes in MongoDB (`significant-eqs` collection): the implementation used when
// SIGNIFICANT_EQS_DB=mongodb. Keep it behaving like postgres/significantEqs.repo.js: both must pass
// __tests__/significantEqs.repo.integration.test.js.
//
// Records are returned in the shape the API sends (`_id`, field names as stored);
// __tests__/golden/ holds the recorded responses to check against.
const { Types } = require('mongoose');
const SignificantEQs = require('../../models/significantEQ.model');

// Whether `id` has the format of a record id (lets the API tell "invalid id" from "not found")
const isValidId = (id) => Types.ObjectId.isValid(id);

// In the order the records were added (MongoDB's natural order), which is the order the page shows
const findAll = async () => SignificantEQs.find({}).lean();

// Resolves to null when no record has this id
const findById = async (id) => SignificantEQs.findById(id).lean();

module.exports = {
  isValidId,
  findAll,
  findById,
};
