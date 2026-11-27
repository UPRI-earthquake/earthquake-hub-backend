// set_updated_at() used to keep an UPDATE's updated_at whenever it differed from the old value, and
// otherwise set now(). A copy script re-writing a row with an unchanged MongoDB updated_at hit the
// second case, so the row got now() and looked "changed in PostgreSQL": every later copy kept it, and
// MongoDB changes after the second run were never copied.
//
// Now writes that carry their own updated_at say so explicitly: the copy scripts set the transaction
// setting app.preserve_updated_at = 'on' (scripts/lib/pgCopy.js). Every other UPDATE gets now().

exports.up = async (knex) => {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('app.preserve_updated_at', true) IS DISTINCT FROM 'on' THEN
        NEW.updated_at := now();
      END IF;
      RETURN NEW;
    END
    $$
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
        NEW.updated_at := now();
      END IF;
      RETURN NEW;
    END
    $$
  `);
};
