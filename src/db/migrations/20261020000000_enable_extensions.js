// PostGIS for geography columns (event/device locations), citext for case-insensitive emails and
// usernames. CREATE EXTENSION needs a superuser: the PG_USER the container creates is one.

exports.up = async (knex) => {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS citext');
};

exports.down = async (knex) => {
  await knex.raw('DROP EXTENSION IF EXISTS citext');
  await knex.raw('DROP EXTENSION IF EXISTS postgis');
};
