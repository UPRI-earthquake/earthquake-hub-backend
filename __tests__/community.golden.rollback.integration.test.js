// Community on MongoDB with accounts and events on PostgreSQL: dev after rolling community back
// (COMMUNITY_DB=mongodb), as it ran before the switch. Must match the same recordings as on MongoDB.
const { describeCommunityGolden } = require('./fixtures/communityGolden');

describeCommunityGolden({ PEOPLE_AND_SENSORS_DB: 'postgres', EARTHQUAKES_DB: 'postgres' });
