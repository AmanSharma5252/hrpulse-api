const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

exports.register = asyncHandler(async (req, res) => {
  const { email, password, full_name, role, department, company_id } = req.body;

  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) return res.status(400).json({ success: false, error: error.message });

  await supabase.from("profiles").update({
    role, department: department || null, company_id: company_id || null, full_name,
  }).eq("id", data.user.id);

  // Seed leave balances
  const { data: ltypes } = await supabase.from("leave_types").select("id, default_days");
  if (ltypes?.length) {
    const year     = new Date().getFullYear();
    const balances = ltypes.map(t => ({
      employee_id: data.user.id, leave_type_id: t.id,
      year, total_days: t.default_days, used_days: 0, pending_days: 0,
    }));
    await supabase.from("leave_balances").upsert(balances, { onConflict: "employee_id,leave_type_id,year" });
  }

  res.status(201).json({ success: true, message: "Employee registered",
    user: { id: data.user.id, email, full_name, role } });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ success: false, error: "Invalid email or password" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, department, title, phone, avatar_initials, employee_code, hire_date, company_id, is_active, emergency_contact")
    .eq("id", data.user.id)
    .single();

  if (profile && !profile.is_active)
    return res.status(403).json({ success: false, error: "Account deactivated" });

  const user = {
    id:                data.user.id,
    email:             data.user.email,
    name:              profile?.full_name         || data.user.email,
    role:              profile?.role              || "employee",
    department:        profile?.department,
    title:             profile?.title,
    phone:             profile?.phone,
    emergency_contact: profile?.emergency_contact,
    avatar_initials:   profile?.avatar_initials   || "?",
    employee_code:     profile?.employee_code,
    hire_date:         profile?.hire_date,
    company_id:        profile?.company_id,
  };

  res.json({ success: true, access_token: data.session.access_token, refresh_token: data.session.refresh_token, user });
});

exports.refresh = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ success: false, error: "Refresh token required" });

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error) return res.status(401).json({ success: false, error: "Invalid refresh token" });

  res.json({ success: true, access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});

exports.me = asyncHandler(async (req, res) => {
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, department, title, phone, avatar_initials, employee_code, hire_date, company_id, emergency_contact")
    .eq("id", req.user.id)
    .single();

  const today = new Date().toISOString().split("T")[0];
  const { data: todayAtt } = await supabase
    .from("attendance").select("status, check_in, check_out")
    .eq("employee_id", req.user.id).eq("date", today).single();

  res.json({ success: true, user: { id: req.user.id, email: req.user.email, ...profile, today: todayAtt || null } });
});

exports.logout = asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) await supabase.auth.admin.signOut(token).catch(() => {});
  res.json({ success: true, message: "Logged out" });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: req.user.email, password: current_password });
  if (authErr) return res.status(400).json({ success: false, error: "Current password is incorrect" });

  const { error } = await supabase.auth.admin.updateUserById(req.user.id, { password: new_password });
  if (error) return res.status(400).json({ success: false, error: error.message });

  res.json({ success: true, message: "Password updated successfully" });
});
