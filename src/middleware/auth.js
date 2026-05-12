const supabase = require("../config/supabase");

exports.protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null;

    if (!token) return res.status(401).json({ success: false, error: "No token provided" });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ success: false, error: "Invalid or expired token" });

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, role, department, title, phone, avatar_initials, employee_code, hire_date, company_id, is_active")
      .eq("id", user.id)
      .single();

    if (profile && !profile.is_active)
      return res.status(403).json({ success: false, error: "Account deactivated" });

    req.user = {
      id:         user.id,
      email:      user.email,
      name:       profile?.full_name    || user.email,
      role:       profile?.role         || "employee",
      dept:       profile?.department   || null,
      title:      profile?.title        || null,
      company_id: profile?.company_id   || null,
      code:       profile?.employee_code|| null,
      avatar:     profile?.avatar_initials || "?",
    };

    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Authentication failed" });
  }
};

exports.authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role))
    return res.status(403).json({ success: false, error: `Access denied. Required: ${roles.join(", ")}` });
  return next();
};
