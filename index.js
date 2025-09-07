import dotenv from "dotenv";
dotenv.config();
console.log(process.env.ZMQ_URL);
import express from "express";
import OrderController from "./order/order.controller.js";
import { PublisherZMQ } from "./zeromq/publisher.js";

const app = express();
const PORT = process.env.PORT || 3000;
const publisherZMQ = new PublisherZMQ(process.env.ZMQ_URL);
const orderController = new OrderController(publisherZMQ);
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.post("/order", orderController.createOrder);
app.get("/order/list", orderController.getOrders);
app.get("/order/positions", orderController.getPositions);
app.delete("/order/:orderId", orderController.cancelOrder);
app.delete("/order", orderController.clearOrders);

app.get("/", (req, res) => {
  res.json({
    message: "Welcome to the Report Server!",
    status: "Server is running successfully",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 404 handler - must be after all other routes
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`⚡ Environment: ${process.env.NODE_ENV || "development"}`);
});
