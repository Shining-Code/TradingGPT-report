import zmq from "zeromq";

export class PublisherZMQ {
  sock = new zmq.Publisher();

  constructor(zmqUrl) {
    this.sock.bind(zmqUrl);
    console.log(`[PublisherZMQ] Publisher bound to ${zmqUrl}`);
  }

  publish(topic, message) {
    this.sock.send([topic, JSON.stringify(message)]);
    //console.log(`[PublisherZMQ] Published ${topic} ${JSON.stringify(message)}`);
  }
}
