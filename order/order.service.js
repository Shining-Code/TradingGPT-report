import { TOPIC } from "../constants/topics.js";

class OrderService {
  counterLog = 0;
  constructor(streamClient, publisherZMQ) {
    this.streamClient = streamClient;
    this.orders = [];
    this.positions = new Map();
    this.setupListeners();
    this.publisherZMQ = publisherZMQ;
    this.limitLog = 6;
  }

  setupListeners() {
    if (this.streamClient) {
      // Listen for price updates from the stream client
      this.streamClient.on(TOPIC.PRICE_UPDATE, (priceData) => {
        this.handlePriceUpdate(priceData);
      });
      console.log("🎯 OrderBookService listeners initialized");
    }
  }

  cancelOrder(symbol) {
    const orderIndex = this.orders.findIndex(
      (order) => order.symbol === symbol
    );
    if (orderIndex >= 0) {
      this.orders.splice(orderIndex, 1);
      const position = this.positions.get(symbol);
      if (position) {
        this.positions.delete(symbol);
      }
    }
  }

  placeOrder(orderData) {
    const order = {
      id: Date.now().toString(),
      symbol: orderData.symbol,
      side: orderData.side, // 'buy' or 'sell'
      type: orderData.type, // 'market', 'limit', 'stop'
      quantity: orderData.quantity,
      price: orderData.price,
      stopPrice: orderData.stopPrice,
      leverage: orderData.leverage || 1, // Default leverage 1x
      takeProfit: orderData.takeProfit || null, // Take profit price
      stopLoss: orderData.stopLoss || null, // Stop loss price
      status: "pending",
      timestamp: new Date().toISOString(),
    };

    this.orders.push(order);

    const priceInfo =
      order.type === "market"
        ? "MARKET PRICE"
        : order.type === "limit"
        ? `$${order.price}`
        : order.type === "stop"
        ? `STOP $${order.stopPrice}`
        : `$${order.price || 0}`;

    console.log(
      `📝 New ${order.type.toUpperCase()} order added: ${order.side.toUpperCase()} ${
        order.quantity
      } ${order.symbol} @ ${priceInfo} | Leverage: ${order.leverage}x | TP: ${
        order.takeProfit || "None"
      } | SL: ${order.stopLoss || "None"}`
    );
    return order;
  }

  handlePriceUpdate(priceData) {
    // Check for pending orders that might be triggered
    this.checkPendingOrders(priceData);

    // Update position P&L if we have positions
    this.updatePnL(priceData);
  }

  checkPendingOrders(priceData) {
    // find order for this symbol
    const order = this.orders.find(
      (order) => order.symbol === priceData.symbol && order.status === "pending"
    );
    if (!order) return;
    let shouldExecute = false;
    if (order.type === "market") {
      shouldExecute = true;
      console.log(
        `🚀 MARKET order ${order.symbol} executing immediately at $${priceData.close}`
      );
    }
    // Check LIMIT buy orders
    else if (
      order.side === "buy" &&
      order.type === "limit" &&
      priceData.close <= order.price
    ) {
      shouldExecute = true;
      console.log(
        `📈 LIMIT BUY triggered: price $${priceData.close} <= limit $${order.price}`
      );
    }
    // Check LIMIT sell orders
    else if (
      order.side === "sell" &&
      order.type === "limit" &&
      priceData.close >= order.price
    ) {
      shouldExecute = true;
      console.log(
        `📉 LIMIT SELL triggered: price $${priceData.close} >= limit $${order.price}`
      );
    }
    // Check STOP orders
    else if (
      order.type === "stop" &&
      ((order.side === "buy" && priceData.close >= order.stopPrice) ||
        (order.side === "sell" && priceData.close <= order.stopPrice))
    ) {
      shouldExecute = true;
      console.log(`🛑 STOP order triggered at $${priceData.close}`);
    }

    if (shouldExecute) {
      this.executeOrder(order, priceData);
    }
  }

  executeOrder(order, priceData) {
    order.status = "filled";
    order.fillPrice = priceData.close;
    order.fillTime = new Date().toISOString();

    console.log(
      `✅ Order matched: ${order.side} ${order.quantity} ${order.symbol} at $${order.fillPrice}`
    );
    this.updatePosition(order);
  }

  updatePosition(order) {
    const positionKey = order.symbol;
    const existingPosition = this.positions.get(positionKey) || {
      symbol: order.symbol,
      side: order.side,
      quantity: 0,
      avgPrice: 0,
      unrealizedPnL: 0,
      takeProfit: order.takeProfit,
      stopLoss: order.stopLoss,
      liquidationPrice: 0,
    };
    if (existingPosition.quantity === 0) {
      existingPosition.quantity = order.quantity * order.leverage;
      existingPosition.avgPrice = order.fillPrice;
    } else {
      const newAvgPrice =
        existingPosition.avgPrice * existingPosition.quantity +
        order.fillPrice * order.quantity * order.leverage;
      existingPosition.avgPrice = newAvgPrice;
      existingPosition.takeProfit = order.takeProfit;
      existingPosition.stopLoss = order.stopLoss;
    }

    const maintenanceMargin = 0.01; // 1% maintenance margin
    if (order.side === "buy") {
      // Long position
      existingPosition.liquidationPrice =
        existingPosition.avgPrice *
        (1 - 1 / order.leverage + maintenanceMargin);
    } else {
      existingPosition.liquidationPrice =
        existingPosition.avgPrice *
        (1 + 1 / order.leverage + maintenanceMargin);
    }
    this.positions.set(positionKey, existingPosition);
    console.log(
      `📊 Position updated for ${order.symbol}: ${
        existingPosition.quantity
      } @ $${existingPosition.avgPrice.toFixed(2)} | Leverage: ${
        order.leverage
      }x | Liquidation: $${existingPosition.liquidationPrice.toFixed(2)}`
    );
  }

  updatePnL(priceData) {
    const position = this.positions.get(priceData.symbol);
    if (!position) return;
    let direction = 1;
    if (position.side === "sell") direction = -1;
    if (position.quantity !== 0) {
      position.unrealizedPnL =
        (priceData.close - position.avgPrice) * position.quantity * direction;
    }

    if (this.counterLog % this.limitLog == 0) {
      console.log(
        `💹 ${priceData.symbol} P&L: $${position.unrealizedPnL.toFixed(
          2
        )} | Price: $${priceData.close} | AvgPrice: ${position.avgPrice}`
      );
      this.publisherZMQ.publish(TOPIC.POSITION_UPDATE, position);
      this.counterLog = 0;
    }

    if (this.checkLiquidation(position, priceData)) {
      console.log(
        `🚨 LIQUIDATION TRIGGERED for ${position.symbol} at $${priceData.close}!`
      );
      console.log(
        `💀 Position liquidated: ${position.quantity} ${
          position.symbol
        } | Loss: $${position.unrealizedPnL.toFixed(2)}`
      );

      // Close the position
      this.positions.delete(priceData.symbol);
      this.publisherZMQ.publish(TOPIC.LIQUIDATION_UPDATE, position);
    } else if (this.checkTPSL(position, priceData)) {
      console.log(
        `💰 Position closed: ${position.quantity} ${
          position.symbol
        } | P&L: $${position.unrealizedPnL.toFixed(2)} `
      );
      // Close the position
      this.positions.delete(priceData.symbol);
      this.publisherZMQ.publish(TOPIC.TAKE_PROFIT_STOP_LOSS_UPDATE, position);
    }
    this.counterLog++;
  }

  checkLiquidation(position, priceData) {
    let shouldLiquidate = false;
    if (position.liquidationPrice > 0) {
      if (position.side === "buy") {
        // Long position
        shouldLiquidate = priceData.close <= position.liquidationPrice;
      } else {
        // Short position
        shouldLiquidate = priceData.close >= position.liquidationPrice;
      }
    }
    return shouldLiquidate;
  }

  checkTPSL(position, priceData) {
    if (position.quantity === 0) return;
    let shouldClose = false;
    switch (position.side) {
      case "buy": {
        // LONG Take Profit: Price goes UP and hits TP level
        if (position.takeProfit && priceData.close >= position.takeProfit) {
          shouldClose = true;
        }
        // LONG Stop Loss: Price goes DOWN and hits SL level
        else if (position.stopLoss && priceData.close <= position.stopLoss) {
          shouldClose = true;
        }
        break;
      }
      case "sell": {
        // SHORT Take Profit: Price goes DOWN and hits TP level
        if (position.takeProfit && priceData.close <= position.takeProfit) {
          shouldClose = true;
        }
        // SHORT Stop Loss: Price goes UP and hits SL level
        else if (position.stopLoss && priceData.close >= position.stopLoss) {
          shouldClose = true;
        }
      }
    }

    return shouldClose;
  }

  getOrders() {
    return this.orders;
  }

  // Get all positions
  getPositions() {
    return Array.from(this.positions.values());
  }
}

export default OrderService;
