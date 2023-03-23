// Create DB and collections
db = new Mongo().getDB("testDb");
db.createCollection("accounts", { capped: false });
db.createCollection("accountdetails", { capped: false });
