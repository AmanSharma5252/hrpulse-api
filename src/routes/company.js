const { Router } = require("express");
const ctrl = require("../controllers/companyController");
const { protect, authorize } = require("../middleware/auth");

const router = Router();
router.use(protect);

router.get  ("/settings",      ctrl.getSettings);
router.patch("/settings",      authorize("admin", "hr"), ctrl.updateSettings);
router.post ("/upload-asset",  authorize("admin"),       ctrl.uploadAsset);

module.exports = router;