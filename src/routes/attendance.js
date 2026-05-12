const { Router } = require("express");
const ctrl = require("../controllers/attendanceController");
const { protect, authorize } = require("../middleware/auth");
const { validate, schemas }  = require("../middleware/validate");

const router = Router();
router.use(protect);
router.get ("/my",         ctrl.getMyAttendance);
router.get ("/my/summary", ctrl.getMySummary);
router.post("/checkin",    validate(schemas.clockIn),  ctrl.checkIn);
router.post("/checkout",   validate(schemas.clockOut), ctrl.checkOut);
router.get ("/team",       authorize("admin","hr","manager"), ctrl.getTeamAttendance);
module.exports = router;
