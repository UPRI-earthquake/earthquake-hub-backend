// Community with accounts and events on PostgreSQL, as dev runs now (comments and points stay on MongoDB
// until Step 4 - Ticket 3 adds their setting here): must match the same recordings as on MongoDB
const { describeCommunityGolden } = require('./fixtures/communityGolden');

describeCommunityGolden({ PEOPLE_AND_SENSORS_DB: 'postgres', EARTHQUAKES_DB: 'postgres' });
