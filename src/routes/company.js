const { Router } = require("express");
const ctrl = require("../controllers/companiesController");
const { protect, authorize } = require("../middleware/auth");

const router = Router();
router.use(protect);
router.get   ("/",        authorize("admin","hr","super_admin"), ctrl.list);
router.patch ("/:id/plan",   authorize("super_admin"), ctrl.updatePlan);
router.patch ("/:id/status", authorize("super_admin"), ctrl.updateStatus);
module.exports = router;
