const redis = require('redis');
const { GenericContainer } = require("testcontainers");
const messaging = require('../routes/messaging');

describe("Messaging thru Redis Pub/Sub", () => {
  let container;
  let redisPublisher;


  beforeAll(async () => {
    container = await new GenericContainer("redis") // use redis docker image
      .withExposedPorts(6379)                       // expose internal port to host
      .start();

    // setup publisher
    redisPublisher = redis.createClient({
      url:`redis://${container.getHost()}:${container.getMappedPort(6379)}`
    });
    await redisPublisher.connect();

    // setup messaging subscriber
    await messaging.redisProxy({
      url:`redis://${container.getHost()}:${container.getMappedPort(6379)}`
    });
  }, 10000);

  afterAll(async () => {
    redisPublisher && (await redisPublisher.quit()); // use quit instead of disconnect!!
    messaging.quitRedisProxy();
    container && (await container.stop());
  });

  it("should call newEvent method on receipt of message", async () => {
    let msgSent = '{"message": "test"}';
    let channel = "SC_PICK";
    let newEventSpy = jest.spyOn(messaging.eventCache, 'newEvent');

    await redisPublisher.publish(channel, msgSent)
    // delay checking by 10ms to give Redis container some time to relay msg
    await new Promise(resolve => setTimeout(resolve, 10)); // resolves after 10ms
    expect(newEventSpy).toHaveBeenCalledTimes(1); // execute after await above
    newEventSpy.mockClear();
  });

  it("should log channel: SC_PICK received", async () => {
    let msgSent = '{"message": "test"}';
    let channel = "SC_PICK"; // NOTE: should not be SC_EVENT (doing so will cause logging of cache)
    let logSpy = jest.spyOn(console, 'log');

    await redisPublisher.publish(channel, msgSent)
    // delay checking by 10ms to give Redis container some time to relay msg
    await new Promise(resolve => setTimeout(resolve, 10)); // resolves after 10ms
    expect(logSpy).toHaveBeenCalledWith(`messaging.js received: ${channel}`); // execute after await above
    logSpy.mockClear();
  });

  it("should call newEvent event-handler on receipt of message", async () => {
    let msgSent = '{"message": "test"}';
    let channel = "SC_PICK";
    let handler = jest.fn();

    messaging.eventCache.on("newEvent", handler) // assign a mock function as handler of event
    await redisPublisher.publish(channel, msgSent)
    // delay checking by 10ms to give Redis container some time to relay msg
    await new Promise(resolve => setTimeout(resolve, 10)); // resolves after 10ms
    expect(handler).toHaveBeenCalledTimes(1); // execute after await above
    handler.mockClear();
  });

});
