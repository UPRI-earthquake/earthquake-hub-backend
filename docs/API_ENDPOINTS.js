// Stations
"stations": [
  // Each station info
  {
    "network": "AM", //2 chars
    "code" : "RE722", //str
    "coords" : {"lat": 123.3210, "lng": 123.3210},
    "place": "String up to 128 chars",
  },
  {...},
]
// Events 
"events": [
  // Each event info
  {
    "code" : "publicID", //str
    "mag" : 8.1,
    "timestamp" : 12345677,
    "coords" : {"lat": 123.3210, "lng": 123.3210},
    "place": "String up to 128 chars",
  },
  {...},
]
// Pick Messages
{
  "message":"pick",
  "networkCode": "AM",
  "stationCode": "RE722"
  "timestamp": 1629794613
}
// Event Messages
//
// Station velocities
