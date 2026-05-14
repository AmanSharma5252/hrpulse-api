const { Router } = require("express");
const ctrl = require("../controllers/employeeController");
const { protect, authorize } = require("../middleware/auth");
const { validate, schemas }  = require("../middleware/validate");

const router = Router();
router.use(protect);
router.get   ("/",    authorize("admin","hr","manager","super_admin"), ctrl.list);
router.post  ("/",    authorize("admin","hr","super_admin"),           validate(schemas.addEmployee),    ctrl.create);
router.patch ("/:id", authorize("admin","hr","super_admin"),           validate(schemas.updateEmployee), ctrl.update);
router.delete("/:id", authorize("admin","super_admin"),                ctrl.deactivate);
module.exports = router;
