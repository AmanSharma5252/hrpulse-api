require("dotenv").config();

const express     = require("express");
const http        = require("http");
const { Server }  = require("socket.io");
const cors        = require("cors");
const morgan      = require("morgan");
const helmet      = require("helmet");
const compression = require("compression");
const rateLimit   = require("express-rate-limit");

const { errorHandler }    = require("./middleware/errorHandler");
const authRoutes           = require("./routes/auth");
const attendanceRoutes     = require("./routes/attendance");
const employeeRoutes       = require("./routes/employees");
const leaveRoutes          = require("./routes/leave");
const dashboardRoutes      = require("./routes/dashboard");
const analyticsRoutes      = require("./routes/analytics");
const payrollRoutes        = require("./routes/payroll");

const app    = express();
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true },
});
app.set("io", io);
io.on("connection", (socket) => {
  const room = socket.handshake.query.companyId;
  if (room) socket.join(`co_${room}`);
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

const origins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map(s => s.trim());
app.use(cors({
  origin: (o, cb) => {
    // Allow requests with no origin (mobile, curl, Render health checks)
    if (!o) return cb(null, true);
    // Allow any vercel.app subdomain for deployed frontends
    if (o.endsWith(".vercel.app")) return cb(null, true);
    // Allow explicitly configured origins
    if (origins.includes(o)) return cb(null, true);
    return cb(new Error("CORS blocked: " + o));
  },
  credentials: true,
}));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/",       (_, res) => res.json({ service: "HRPulse API", version: "3.0.0", status: "running", ts: new Date() }));
app.get("/health", (_, res) => res.json({ status: "ok" }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/v1/auth",       authLimiter, authRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/employees",  employeeRoutes);
app.use("/api/v1/leave",      leaveRoutes);
app.use("/api/v1/dashboard",  dashboardRoutes);
app.use("/api/v1/analytics",  analyticsRoutes);
app.use("/api/v1/payroll",    payrollRoutes);

// ── 404 & Error ───────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ success: false, error: "Route not found" }));
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "4000");
server.listen(PORT, () => {
  console.log(`\n🫀  HRPulse API  →  http://localhost:${PORT}`);
  console.log(`    Mode : ${process.env.NODE_ENV || "development"}`);
  console.log(`    CORS : ${origins.join(", ")}\n`);
});
