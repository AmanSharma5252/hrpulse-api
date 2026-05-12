const { Router } = require("express");
const ctrl = require("../controllers/superAdminController");
const { protect } = require("../middleware/auth");

const router = Router();
router.use(protect);
router.get("/stats",                  ctrl.getStats);
router.get("/companies",              ctrl.listCompanies);
router.get("/companies/:id",          ctrl.getCompanyDetail);
router.patch("/companies/:id/suspend",ctrl.suspendCompany);
router.patch("/companies/:id/plan",   ctrl.updatePlan);

module.exports = router;
