const redis = require('redis');
const { GenericContainer } = require("testcontainers");

describe("Messaging thru Redis Pub/Sub", () => {
  let container;
  let redisClient;
  let redisPublisher;
  let redisSubscriber;


  beforeAll(async () => {
    container = await new GenericContainer("redis") // use redis docker image
      .withExposedPorts(6379)                       // expose internal port to host
      .start();

    redisClient = redis.createClient({
      url:`redis://${container.getHost()}:${container.getMappedPort(6379)}`
    });
    redisPublisher = redisClient.duplicate();
    redisSubscriber = redisClient.duplicate();
    await redisPublisher.connect();
    await redisSubscriber.connect();
  });

  afterAll(async () => {
    redisPublisher && (await redisPublisher.quit()); // use quit instead of disconnect!!
    redisSubscriber && (await redisSubscriber.quit());
    container && (await container.stop());
  });

  it("should read published objects to Redis", async () => {
    let msgSent = "TEST MESSAGE";
    let redisChannel = "SC_*";
    await redisSubscriber.pSubscribe(redisChannel, (msgRcvd) =>{
      expect(msgRcvd).toBe(msgSent); // run here because of async race condition
    });
    await redisPublisher.publish("SC_*", msgSent)
  });
});
