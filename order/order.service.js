import { TOPIC } from "../constants/topics.js";

class OrderService {
  constructor(streamClient, publisherZMQ) {
    this.streamClient = streamClient;
    this.orders = [];
    this.positions = new Map();
    this.setupListeners();
    this.publisherZMQ = publisherZMQ;
  }

  setupListeners() {
    if (this.streamClient) {
      // Listen for price updates from the stream client
      this.streamClient.on(TOPIC.PRICE_UPDATE, (priceData) => {
        this.handlePriceUpdate(priceData);
      });
      console.log("🎯 OrderService listeners initialized");
    }
  }

  handlePriceUpdate(priceData) {
    // Check for pending orders that might be triggered
    this.checkPendingOrders(priceData);

    // Update position P&L if we have positions
    this.updatePositionPnL(priceData);
  }

  checkPendingOrders(priceData) {
    // Filter orders for this symbol
    const symbolOrders = this.orders.filter(
      (order) => order.symbol === priceData.symbol && order.status === "pending"
    );

    symbolOrders.forEach((order) => {
      let shouldExecute = false;

      // Check buy orders
      if (
        order.side === "buy" &&
        order.type === "limit" &&
        priceData.close <= order.price
      ) {
        shouldExecute = true;
      }
      // Check sell orders
      else if (
        order.side === "sell" &&
        order.type === "limit" &&
        priceData.close >= order.price
      ) {
        shouldExecute = true;
      }
      // Check stop orders
      else if (
        order.type === "stop" &&
        ((order.side === "buy" && priceData.close >= order.stopPrice) ||
          (order.side === "sell" && priceData.close <= order.stopPrice))
      ) {
        shouldExecute = true;
      }

      if (shouldExecute) {
        this.executeOrder(order, priceData);
      }
    });
  }

  executeOrder(order, priceData) {
    order.status = "filled";
    order.fillPrice = priceData.close;
    order.fillTime = new Date().toISOString();

    console.log(
      `✅ Order executed: ${order.side} ${order.quantity} ${order.symbol} at $${order.fillPrice}`
    );

    // Update positions
    this.updatePosition(order);
  }

  updatePosition(order) {
    const positionKey = order.symbol;
    const existingPosition = this.positions.get(positionKey) || {
      symbol: order.symbol,
      quantity: 0,
      avgPrice: 0,
      unrealizedPnL: 0,
      leverage: order.leverage || 1,
      takeProfit: order.takeProfit,
      stopLoss: order.stopLoss,
      liquidationPrice: 0,
      margin: 0,
    };

    // Handle position updates based on order side
    if (order.side === "buy") {
      // BUY order: increases long position or reduces short position
      const newQuantity = existingPosition.quantity + order.quantity;
      const newAvgPrice =
        existingPosition.quantity === 0
          ? order.fillPrice
          : (existingPosition.avgPrice * Math.abs(existingPosition.quantity) +
              order.fillPrice * order.quantity) /
            Math.abs(newQuantity);

      existingPosition.quantity = newQuantity;
      existingPosition.avgPrice = newAvgPrice;
    } else {
      // SELL order: decreases long position or increases short position
      const newQuantity = existingPosition.quantity - order.quantity;
      const newAvgPrice =
        existingPosition.quantity === 0
          ? order.fillPrice
          : (existingPosition.avgPrice * Math.abs(existingPosition.quantity) +
              order.fillPrice * order.quantity) /
            Math.abs(newQuantity);

      existingPosition.quantity = newQuantity;
      existingPosition.avgPrice = newAvgPrice;
    }
    existingPosition.leverage = order.leverage;
    existingPosition.takeProfit = order.takeProfit;
    existingPosition.stopLoss = order.stopLoss;

    // Calculate margin and liquidation price for leveraged positions
    if (existingPosition.leverage > 1 && existingPosition.quantity !== 0) {
      existingPosition.margin =
        (existingPosition.avgPrice * Math.abs(existingPosition.quantity)) /
        existingPosition.leverage;

      // Calculate liquidation price (simplified calculation)
      // For long positions: liquidationPrice = avgPrice * (1 - 1/leverage + maintenanceMargin)
      // For short positions: liquidationPrice = avgPrice * (1 + 1/leverage + maintenanceMargin)
      const maintenanceMargin = 0.005; // 0.5% maintenance margin
      if (existingPosition.quantity > 0) {
        // Long position (positive quantity)
        existingPosition.liquidationPrice =
          existingPosition.avgPrice *
          (1 - 1 / existingPosition.leverage + maintenanceMargin);
      } else {
        // Short position (negative quantity)
        existingPosition.liquidationPrice =
          existingPosition.avgPrice *
          (1 + 1 / existingPosition.leverage + maintenanceMargin);
      }
    }

    this.positions.set(positionKey, existingPosition);
    console.log(
      `📊 Position updated for ${order.symbol}: ${
        existingPosition.quantity
      } @ $${existingPosition.avgPrice.toFixed(2)} | Leverage: ${
        existingPosition.leverage
      }x | Liquidation: $${existingPosition.liquidationPrice.toFixed(2)}`
    );
  }

  updatePositionPnL(priceData) {
    const position = this.positions.get(priceData.symbol);
    if (position && position.quantity !== 0) {
      position.unrealizedPnL =
        (priceData.close - position.avgPrice) *
        position.quantity *
        position.leverage;

      // Check for liquidation
      this.checkLiquidation(position, priceData);

      // Check for take profit and stop loss
      this.checkTakeProfitStopLoss(position, priceData);

      console.log(
        `💹 ${priceData.symbol} P&L: $${position.unrealizedPnL.toFixed(
          2
        )} | Price: $${priceData.close}`
      );
      this.publisherZMQ.publish(TOPIC.POSITION_UPDATE, position);
    }
  }

  checkLiquidation(position, priceData) {
    if (position.liquidationPrice > 0) {
      let shouldLiquidate = false;

      if (position.quantity > 0) {
        // Long position
        shouldLiquidate = priceData.close <= position.liquidationPrice;
      } else {
        // Short position
        shouldLiquidate = priceData.close >= position.liquidationPrice;
      }

      if (shouldLiquidate) {
        console.log(
          `🚨 LIQUIDATION TRIGGERED for ${position.symbol} at $${priceData.close}!`
        );
        console.log(
          `💀 Position liquidated: ${position.quantity} ${
            position.symbol
          } | Loss: $${position.unrealizedPnL.toFixed(2)}`
        );

        // Close the position
        position.quantity = 0;
        position.unrealizedPnL = 0;
        position.avgPrice = 0;
        position.liquidationPrice = 0;
        position.margin = 0;

        // Emit liquidation event or add to liquidation history
        this.handleLiquidation(position, priceData);
      }
    }
  }

  checkTakeProfitStopLoss(position, priceData) {
    if (position.quantity === 0) return;

    let shouldClose = false;
    let closeReason = "";

    // Position Direction Logic:
    // Positive quantity = LONG position (you own the asset)
    // Negative quantity = SHORT position (you owe/borrowed the asset)
    const isLongPosition = position.quantity > 0;
    const isShortPosition = position.quantity < 0;

    // LONG POSITION CONDITIONS
    if (isLongPosition) {
      // LONG Take Profit: Price goes UP and hits TP level
      if (position.takeProfit && priceData.close >= position.takeProfit) {
        shouldClose = true;
        closeReason = "Take Profit";
      }
      // LONG Stop Loss: Price goes DOWN and hits SL level
      else if (position.stopLoss && priceData.close <= position.stopLoss) {
        shouldClose = true;
        closeReason = "Stop Loss";
      }
    }

    // SHORT POSITION CONDITIONS
    else if (isShortPosition) {
      // SHORT Take Profit: Price goes DOWN and hits TP level
      if (position.takeProfit && priceData.close <= position.takeProfit) {
        shouldClose = true;
        closeReason = "Take Profit";
      }
      // SHORT Stop Loss: Price goes UP and hits SL level
      else if (position.stopLoss && priceData.close >= position.stopLoss) {
        shouldClose = true;
        closeReason = "Stop Loss";
      }
    }

    if (shouldClose) {
      const finalPnL = position.unrealizedPnL;
      const positionType = isLongPosition ? "LONG" : "SHORT";

      console.log(
        `${
          closeReason === "Take Profit" ? "🎯" : "⛔"
        } ${closeReason} triggered for ${positionType} ${position.symbol} at $${
          priceData.close
        }`
      );
      console.log(
        `💰 Position closed: ${position.quantity} ${
          position.symbol
        } | P&L: $${finalPnL.toFixed(2)}`
      );

      // Close the position
      position.quantity = 0;
      position.unrealizedPnL = 0;
      position.avgPrice = 0;
      position.liquidationPrice = 0;
      position.margin = 0;
      position.takeProfit = null;
      position.stopLoss = null;

      // Handle position closure
      this.handlePositionClose(position, priceData, closeReason, finalPnL);
    }
  }

  handleLiquidation(position, priceData) {
    // Add liquidation to history or emit event
    console.log(`📝 Liquidation recorded for ${position.symbol}`);
    // You can add liquidation history tracking here
    this.publisherZMQ.publish(TOPIC.LIQUIDATION_UPDATE, position);
  }

  handlePositionClose(position, priceData, reason, pnl) {
    // Add position close to history or emit event
    console.log(
      `📝 Position close recorded: ${reason} | P&L: $${pnl.toFixed(2)}`
    );
    // You can add trade history tracking here
    this.publisherZMQ.publish(TOPIC.TAKE_PROFIT_STOP_LOSS_UPDATE, position);
  }

  // Method to add new orders
  addOrder(orderData) {
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
    console.log(
      `📝 New order added: ${order.side} ${order.quantity} ${order.symbol} @ $${
        order.price
      } | Leverage: ${order.leverage}x | TP: ${
        order.takeProfit || "None"
      } | SL: ${order.stopLoss || "None"}`
    );
    return order;
  }

  // Get all orders
  getOrders() {
    return this.orders;
  }

  // Get all positions
  getPositions() {
    return Array.from(this.positions.values());
  }

  cancelOrder(orderId) {
    const order = this.orders.find((order) => order.id === orderId);
    if (order) {
      order.status = "cancelled";
      console.log(`📝 Order cancelled: ${order.id}`);
    }
  }

  clearOrders() {
    this.orders = [];
    console.log(`📝 Orders cleared`);
  }
}

export default OrderService;
