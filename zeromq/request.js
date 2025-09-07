import zmq from "zeromq";

export class RequestZMQ {
  sock = new zmq.Request();

  constructor(zmqUrl) {
    this.sock.connect(zmqUrl);
  }

  async request(message) {
    await this.sock.send(message);
    const [result] = await this.sock.receive();
    console.log("[RequestZMQ]Received ", result?.toString());
  }
}
