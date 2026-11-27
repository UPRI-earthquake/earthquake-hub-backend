// Significant earthquakes are deprecated: the backend no longer serves them (the /significant-eqs
// endpoints, their repositories and copy script are removed), so their table goes too. The records
// stay in MongoDB, and in its final dump (Phase 4).
//
// Rolling back recreates the table empty, as migrations 20261023000000 and 20261029000400 made it.
const createSignificantEqs = require('./20261023000000_create_significant_eqs');
const linkSignificantEqsToEvents = require('./20261029000400_link_significant_eqs_to_events');

exports.up = async (knex) => {
  await knex.schema.dropTable('significant_eqs');
};

exports.down = async (knex) => {
  await createSignificantEqs.up(knex);
  await linkSignificantEqsToEvents.up(knex);
};
