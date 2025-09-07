import WebSocket from "ws";
import { EventEmitter } from "events";
import { TOPIC } from "../constants/topics.js";

class BinanceStreamClient extends EventEmitter {
  wsUrl = `wss://fstream.binance.com/ws`;
  reconnectAttempts = 0;
  maxReconnectAttempts = 5;
  reconnectDelay = 1000;
  constructor() {
    super();
  }

  connect() {
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        console.log("Connected to Binance Stream");
        this.reconnectAttempts = 0;
        // Send a ping to verify connection
        if (this.ws) {
          this.ws.ping();
          console.log("🏓 Sent ping to verify connection");
        }
        this.emit("connected");
      };

      this.ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error("Error parsing message:", error);
          console.error("Raw data:", data.toString());
        }
      });

      this.ws.on("pong", () => {
        console.log("🏓 Received pong from Binance");
      });

      this.ws.on("close", (code, reason) => {
        console.log(`❌ WebSocket closed: ${code} - ${reason.toString()}`);
        this.handleReconnect();
      });

      this.ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.handleReconnect();
      });

      // Add connection timeout
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          console.error(
            "❌ Connection timeout - WebSocket failed to connect within 10 seconds"
          );
          this.ws.close();
        }
      }, 10000);
    } catch (error) {
      console.error("Error connecting to Binance Stream", error);
    }
  }

  subscribeSymbol(symbol, interval) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const lowerSymbol = symbol.toLowerCase();
      const subscriptionData = {
        method: "SUBSCRIBE",
        params: [`${lowerSymbol}@kline_${interval}`],
        id: Date.now(),
      };

      this.ws.send(JSON.stringify(subscriptionData));
      console.log(`📡 Subscribed to ${lowerSymbol}@kline_${interval}`);
      console.log(`📡 Subscription data:`, subscriptionData);
    } else {
      console.error(
        `❌ Cannot subscribe - WebSocket state: ${
          this.ws ? this.ws.readyState : "null"
        }`
      );
      console.error(`❌ Expected state: ${WebSocket.OPEN} (OPEN)`);
    }
  }

  handleMessage(message) {
    // Handle subscription responses
    if (message.result === null && message.id) {
      console.log(`✅ Subscription confirmed for ID: ${message.id}`);
      return;
    }

    // Handle error messages
    if (message.error) {
      console.error(`❌ Binance error: ${JSON.stringify(message.error)}`);
      return;
    }

    // Handle kline data
    if (message.e === "kline") {
      const kline = message.k;
      const priceData = {
        symbol: message.s,
        timestamp: kline.t,
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
        volume: parseFloat(kline.v),
        interval: kline.i,
        isClosed: kline.x,
      };

      // Always emit price updates, even for open candles for more frequent updates
      this.emit(TOPIC.PRICE_UPDATE, priceData);
    } else if (message.e === "24hrTicker") {
      // Handle 24hr ticker updates
      console.log(
        `📈 24hr Ticker: ${message.s} - Price: $${parseFloat(message.c).toFixed(
          2
        )}`
      );
    } else {
      // Log other message types for debugging
      console.log(
        `📨 Unknown message type: ${JSON.stringify(message).substring(
          0,
          200
        )}...`
      );
    }
  }

  handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error(
        "❌ Max reconnection attempts reached. Please check your connection."
      );
    }
  }
}

export default BinanceStreamClient;
