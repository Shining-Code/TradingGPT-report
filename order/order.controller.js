import OrderService from "./order.service.js";
import BinanceStreamClient from "../binance/stream.js";

class OrderController {
  constructor(publisherZMQ) {
    this.streamClient = new BinanceStreamClient();
    this.orderService = new OrderService(this.streamClient, publisherZMQ);

    // Connect and subscribe with proper timing
    this.streamClient.connect();
    this.streamClient.on("connected", () => {
      console.log("🎉 Stream client connected, subscribing to symbols...");
      // Use shorter interval for testing (1m instead of 1d)
      setTimeout(() => {
        this.streamClient.subscribeSymbol("BTCUSDT", "1m");
        // this.streamClient.subscribeSymbol("ETHUSDT", "1m");
      }, 1000); // Wait 1 second after connection before subscribing
    });
  }

  createOrder = (req, res) => {
    try {
      const order = this.orderService.placeOrder(req.body);
      res.status(201).json(order);
    } catch (error) {
      console.error("Error creating order:", error);
      res.status(500).json({ error: error.message });
    }
  };

  getOrders = (req, res) => {
    try {
      const orders = this.orderService.getOrders();
      res.status(200).json(orders);
    } catch (error) {
      console.error("Error getting orders:", error);
      res.status(500).json({ error: error.message });
    }
  };

  getPositions = (req, res) => {
    try {
      const positions = this.orderService.getPositions();
      res.status(200).json(positions);
    } catch (error) {
      console.error("Error getting positions:", error);
      res.status(500).json({ error: error.message });
    }
  };

  cancelOrder = (req, res) => {
    try {
      const order = this.orderService.cancelOrder(req.params.orderId);
      res.status(200).json(order);
    } catch (error) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ error: error.message });
    }
  };

  clearOrders = (req, res) => {
    try {
      const orders = this.orderService.clearOrders();
      res.status(200).json(orders);
    } catch (error) {
      console.error("Error clearing orders:", error);
      res.status(500).json({ error: error.message });
    }
  };
}

export default OrderController;
