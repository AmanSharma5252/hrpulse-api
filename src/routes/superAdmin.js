const { Router } = require("express");
const ctrl = require("../controllers/superAdminController");
const { protect } = require("../middleware/auth");

const router = Router();
router.use(protect); // all routes require login

router.get ("/companies",              ctrl.listCompanies);
router.get ("/plans",                  ctrl.listPlans);
router.patch("/companies/:id/plan",    ctrl.updateCompanyPlan);
router.patch("/companies/:id/status",  ctrl.updateCompanyStatus);
router.get ("/me/grant",               ctrl.grantSelf); // one-time setup

module.exports = router;
