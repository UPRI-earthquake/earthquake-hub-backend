const redis = require('redis');
const { GenericContainer } = require("testcontainers");
const notifs = require('../routes/notifications');
const events = require('../services/events')
const webpush = require('web-push')
const Subscription = require('../models/subscription');

describe("Notification messages thru Redis Pub/Sub", () => {
  let container;
  let redisPublisher;
  let mag5_6_event = JSON.stringify({
    "message#": 0,
    "eventType": 'NEW',
    "publicID": 'xxxxx',
    "OT": '2021-10-03T12:09:32.000Z',
    "latitude_value": 13.734,
    "longitude_value": 120.595,
    "depth_value": 123,
    "magnitude_value": 5.6, // NOTE: > 5.5
    "text": 'Mindoro, Philipines',
    "method": 'LOCSAT',
    "last_modification": '12-21-21T12:09:32.00%dZ'
  });


  beforeAll(async () => {
    container = await new GenericContainer("redis") // use redis docker image
      .withExposedPorts(6379)                       // expose internal port to host
      .start();

    // setup publisher
    redisPublisher = redis.createClient({
      url:`redis://${container.getHost()}:${container.getMappedPort(6379)}`
    });
    await redisPublisher.connect();

    // setup notifs subscriber
    await notifs.redisProxy({
      url:`redis://${container.getHost()}:${container.getMappedPort(6379)}`
    });
  }, 10000);

  afterAll(async () => {
    redisPublisher && (await redisPublisher.quit()); // use quit instead of disconnect!!
    notifs.quitRedisProxy();
    container && (await container.stop());
  });

  it("should call addPlaces method on receipt of SC_EVENT", async () => {
    let channel = "SC_EVENT";
    let addPlacesSpy = jest.spyOn(events, 'addPlaces');

    await redisPublisher.publish(channel, mag5_6_event)
    // delay checking by 10ms to give Redis container some time to relay msg
    await new Promise(resolve => setTimeout(resolve, 10)); // resolves after 10ms
    expect(addPlacesSpy).toHaveBeenCalledWith([JSON.parse(mag5_6_event)]); // execute after await above
    addPlacesSpy.mockClear();
  });

  it("should log channel: SC_EVENT when received", async () => {
    let msgSent = '{"message": "test"}';
    let channel = "SC_EVENT";
    let logSpy = jest.spyOn(console, 'log');

    await redisPublisher.publish(channel, msgSent)
    // delay checking by 10ms to give Redis container some time to relay msg
    await new Promise(resolve => setTimeout(resolve, 10)); // resolves after 10ms
    expect(logSpy).toHaveBeenCalledWith(`notifications.js received: ${channel}`); // execute after await above
    logSpy.mockClear();
  });

  it("should not call Subscription.find() when MongoDB not connected", async () => {
    let channel = "SC_EVENT";
    let findSpy = jest.spyOn(Subscription, 'find');

    await redisPublisher.publish(channel, mag5_6_event)
    await new Promise(resolve => setTimeout(resolve, 10)); // resolves after 10ms
    expect(findSpy).not.toHaveBeenCalled(); // execute after await above
    findSpy.mockClear();
  });

  it("should NOT call sendNotification when MongoDB not connected", async () => {
    let channel = "SC_EVENT";
    let sendNotificationSpy = jest.spyOn(webpush, 'sendNotification');

    await redisPublisher.publish(channel, mag5_6_event)
    // delay checking by 10ms to give Redis container some time to relay msg
    await new Promise(resolve => setTimeout(resolve, 10)); // resolves after 10ms
    expect(sendNotificationSpy).not.toHaveBeenCalled(); // execute after await above
  });

}, 10000);
