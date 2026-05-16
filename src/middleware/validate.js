const multer = require("multer");
const Joi    = require("joi");

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, WebP images allowed"));
  },
});

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false, stripUnknown: true, convert: true,
  });
  if (error)
    return res.status(422).json({ success: false, error: "Validation failed", details: error.details.map(d => d.message) });
  req.body = value;
  return next();
};

const schemas = {
  register: Joi.object({
    email:      Joi.string().email().required(),
    password:   Joi.string().min(6).required(),
    full_name:  Joi.string().min(2).max(100).required(),
    role:       Joi.string().valid("employee","manager","hr","admin").default("employee"),
    department: Joi.string().optional().allow("", null),
    company_id: Joi.string().uuid().optional().allow("", null),
  }),
  login: Joi.object({
    email:    Joi.string().email().required(),
    password: Joi.string().required(),
  }),
  changePw: Joi.object({
    current_password: Joi.string().required(),
    new_password:     Joi.string().min(6).required(),
  }),
  clockIn: Joi.object({
    latitude:      Joi.number().min(-90).max(90).optional().allow(null),
    longitude:     Joi.number().min(-180).max(180).optional().allow(null),
    selfie_base64: Joi.string().optional().allow("", null),
    note:          Joi.string().max(300).optional().allow("", null),
  }),
  clockOut: Joi.object({
  latitude:              Joi.number().min(-90).max(90).optional().allow(null),
  longitude:             Joi.number().min(-180).max(180).optional().allow(null),
  selfie_base64:         Joi.string().optional().allow("", null),
  note:                  Joi.string().max(300).optional().allow("", null),
  early_checkout_reason: Joi.string().max(500).optional().allow("", null),  // ← ADD THIS
}),
  applyLeave: Joi.object({
    leave_type_id: Joi.string().uuid().required(),
    start_date:    Joi.string().isoDate().required(),
    end_date:      Joi.string().isoDate().required(),
    reason:        Joi.string().min(3).max(500).required(),
  }),
  reviewLeave: Joi.object({
    status:      Joi.string().valid("approved","rejected").required(),
    review_note: Joi.string().max(500).optional().allow("", null),
  }),
  addEmployee: Joi.object({
    email:             Joi.string().email().required(),
    password:          Joi.string().min(6).required(),
    name:              Joi.string().min(2).max(100).required(),
    role:              Joi.string().valid("employee","manager","hr","admin").default("employee"),
    department:        Joi.string().optional().allow("", null),
    title:             Joi.string().optional().allow("", null),
    phone:             Joi.string().optional().allow("", null),
    emergency_contact: Joi.string().optional().allow("", null),
    hire_date:         Joi.string().isoDate().optional().allow("", null),
    company_id:        Joi.string().uuid().optional().allow("", null),
  }),
  updateEmployee: Joi.object({
  name:              Joi.string().min(2).max(100).optional(),
  role:              Joi.string().valid("employee","manager","hr","admin").optional(),
  department:        Joi.string().optional().allow("", null),
  title:             Joi.string().optional().allow("", null),
  phone:             Joi.string().optional().allow("", null),
  emergency_contact: Joi.string().optional().allow("", null),
  hire_date:         Joi.string().isoDate().optional().allow("", null),
  base_salary:       Joi.number().min(0).optional().allow(null),
  hra_pct:           Joi.number().min(0).max(100).optional().allow(null),
  ta_amount:         Joi.number().min(0).optional().allow(null),
  pf_pct:            Joi.number().min(0).max(100).optional().allow(null),
  tax_pct:           Joi.number().min(0).max(100).optional().allow(null),
}),
};

module.exports = { upload, validate, schemas };
