// Replaces the MongoDB `joblocks` collection. Not copied over: locks only live as long as a job run.
// Expired locks are deleted by the cleanup scheduler (subscriptionCleanup.service.js), which replaces
// MongoDB's TTL index; acquiring already treats an expired lock as free.

exports.up = async (knex) => {
  await knex.schema.createTable('job_locks', (table) => {
    table.comment('Mutex for background jobs, so only one backend instance runs a job at a time');
    table.text('name').primary().comment('e.g. additional-information-enrichment');
    table.text('owner').notNullable().comment('hostname:pid of the process holding the lock');
    table.timestamp('expires_at', { useTz: true }).notNullable().index();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    CREATE TRIGGER job_locks_set_updated_at BEFORE UPDATE ON job_locks
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('job_locks');
};
