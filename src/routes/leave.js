const { Router } = require("express");
const ctrl = require("../controllers/leaveController");
const { protect, authorize } = require("../middleware/auth");
const { validate, schemas }  = require("../middleware/validate");

const router = Router();
router.use(protect);
router.get   ("/types",      ctrl.getTypes);
router.get   ("/balances",   ctrl.getBalances);
router.get   ("/my",         ctrl.getMy);
router.get   ("/all",        authorize("admin","hr","manager"), ctrl.getAll);
router.post  ("/apply",      validate(schemas.applyLeave), ctrl.apply);
router.patch ("/:id/review", authorize("admin","hr","manager"), validate(schemas.reviewLeave), ctrl.review);
router.delete("/:id/cancel", ctrl.cancel);
module.exports = router;
