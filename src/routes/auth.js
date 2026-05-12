const { Router } = require("express");
const ctrl = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { validate, schemas } = require("../middleware/validate");

const router = Router();
router.post("/register", validate(schemas.register), ctrl.register);
router.post("/onboard",  ctrl.onboardCompany);
router.post("/login",    validate(schemas.login),    ctrl.login);
router.post("/refresh",  ctrl.refresh);
router.post("/logout",   protect, ctrl.logout);
router.get ("/me",       protect, ctrl.me);
router.patch("/password",protect, validate(schemas.changePw), ctrl.changePassword);
module.exports = router;
