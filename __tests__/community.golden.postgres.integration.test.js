// Community on PostgreSQL (with accounts and events, which comments and points point to): must match the
// same recordings as on MongoDB
const { describeCommunityGolden } = require('./fixtures/communityGolden');

describeCommunityGolden({ COMMUNITY_DB: 'postgres', PEOPLE_AND_SENSORS_DB: 'postgres', EARTHQUAKES_DB: 'postgres' });
