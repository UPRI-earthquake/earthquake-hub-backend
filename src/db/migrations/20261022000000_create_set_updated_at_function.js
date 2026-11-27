// Trigger function that keeps updated_at current. Each table with an updated_at column attaches it:
//
//   CREATE TRIGGER <table>_set_updated_at BEFORE UPDATE ON <table>
//     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
//
// An UPDATE that sets updated_at itself keeps its value, so data-copy scripts can preserve the
// original timestamps from MongoDB.

exports.up = async (knex) => {
  await knex.raw(`
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
        NEW.updated_at := now();
      END IF;
      RETURN NEW;
    END
    $$
  `);
};

exports.down = async (knex) => {
  await knex.raw('DROP FUNCTION set_updated_at()');
};
