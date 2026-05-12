const { Router } = require("express");
const { overview } = require("../controllers/dashboardController");
const { protect, authorize } = require("../middleware/auth");

const router = Router();
router.use(protect);
router.get("/overview", authorize("admin","hr"), overview);
module.exports = router;
