// Errors repositories throw in place of PostgreSQL's own, so services handle them without knowing the
// database.

// A write broke a unique rule. `fields` names what collided (e.g. ['email']).
class DuplicateKeyError extends Error {
  constructor(fields = []) {
    super(`Duplicate value for ${fields.join(', ') || 'a unique field'}`);
    this.name = 'DuplicateKeyError';
    this.fields = fields;
  }
}

// A delete was refused because other records still refer to this one: in PostgreSQL, earthquake
// history (event_stations) keeps the devices it lists. `constraint` names the reference.
class StillReferencedError extends Error {
  constructor(constraint = null) {
    super(`Still referenced${constraint ? ` (${constraint})` : ''}`);
    this.name = 'StillReferencedError';
    this.constraint = constraint;
  }
}

// PostgreSQL unique constraints, as the fields services know them by
const PG_UNIQUE_FIELDS = {
  accounts_email_unique: ['email'],
  accounts_username_unique: ['username'],
  accounts_ringserver_url_unique: ['ringserverUrl'],
  devices_network_station_unique: ['network', 'station'],
  devices_stream_id_unique: ['streamId'],
  devices_mac_address_unique: ['macAddress'],
};

// PostgreSQL's unique_violation (23505) as a DuplicateKeyError; any other error is returned unchanged
const fromPostgresError = (err) => (
  err?.code === '23505' ? new DuplicateKeyError(PG_UNIQUE_FIELDS[err.constraint] || [err.constraint]) : err
);

module.exports = {
  DuplicateKeyError,
  StillReferencedError,
  fromPostgresError,
};
