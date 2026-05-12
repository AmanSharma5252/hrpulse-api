const { Router } = require("express");
const ctrl = require("../controllers/dashboardController");
const { protect, authorize } = require("../middleware/auth");

const router = Router();
router.use(protect);
router.get("/admin", authorize("admin","hr","manager"), ctrl.adminDashboard);
router.get("/me",    ctrl.meDashboard);
router.get("/trend", authorize("admin","hr","manager"), ctrl.trend);
module.exports = router;
