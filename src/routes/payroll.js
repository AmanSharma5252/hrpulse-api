const { Router } = require("express");
const { getPayroll, getMyPayslip } = require("../controllers/dashboardController");
const { protect, authorize } = require("../middleware/auth");

const router = Router();
router.use(protect);
router.get("/",   authorize("admin","hr"), getPayroll);
router.get("/me", getMyPayslip);
module.exports = router;
