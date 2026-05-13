const { Router } = require("express");
const ctrl = require("../controllers/payrollController");
const { protect } = require("../middleware/auth");

const router = Router();
router.use(protect);

router.get("/config",                    ctrl.getConfig);
router.patch("/config",                  ctrl.updateConfig);
router.get("/employees",                 ctrl.getEmployeeSalaries);
router.patch("/employees/:id/salary",    ctrl.updateSalary);
router.get("/summary",                   ctrl.getPayrollSummary);
router.post("/mark-paid",                ctrl.markPaid);
router.post("/mark-all-paid",            ctrl.markAllPaid);
router.post("/send-payslip",             ctrl.sendPayslip);
router.patch("/bank-details",            ctrl.updateBankDetails);

module.exports = router;
