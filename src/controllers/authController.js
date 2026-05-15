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

  res.status(201).json({
    success: true,
    message: "Employee registered",
    user: { id: data.user.id, email, full_name, role },
  });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error)
    return res.status(401).json({ success: false, error: "Invalid email or password" });

  // 1. Fetch user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, role, department, title, phone, avatar_initials, employee_code, hire_date, company_id, is_active, emergency_contact"
    )
    .eq("id", data.user.id)
    .single();

  // 2. Check if individual user account is active
  if (profile && !profile.is_active)
    return res.status(403).json({ success: false, error: "Account deactivated" });

  // 3. ✅ FIX: Check if the company is suspended (skip for super_admin)
  if (profile?.company_id && profile?.role !== "super_admin") {
    const { data: company } = await supabase
      .from("companies")
      .select("is_active, plan")
      .eq("id", profile.company_id)
      .single();

    if (company && !company.is_active) {
      return res.status(403).json({
        success: false,
        suspended: true,
        error: "Your company account has been suspended. Please contact support.",
      });
    }
  }

  // 4. ✅ FIX: Fetch plan — first try company_subscriptions, fallback to companies.plan
  let plan = null;
  if (profile?.company_id) {
    // Try subscriptions table first
    const { data: sub } = await supabase
      .from("company_subscriptions")
      .select("status, trial_ends, billing_end, plans(name, display_name, features, max_employees)")
      .eq("company_id", profile.company_id)
      .single();

    if (sub && sub.plans) {
      plan = {
        ...sub.plans,
        status:      sub.status,
        trial_ends:  sub.trial_ends,
        billing_end: sub.billing_end,
      };
    } else {
      // ✅ Fallback: read plan directly from companies table (updated by super admin)
      const { data: co } = await supabase
        .from("companies")
        .select("plan")
        .eq("id", profile.company_id)
        .single();

      if (co?.plan) {
        plan = { name: co.plan, display_name: co.plan, status: "active" };
      }
    }
  }

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
    plan,
  };

  res.json({
    success:       true,
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    user,
  });
});

exports.refresh = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token)
    return res.status(400).json({ success: false, error: "Refresh token required" });

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error)
    return res.status(401).json({ success: false, error: "Invalid refresh token" });

  res.json({
    success:       true,
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
});

exports.me = asyncHandler(async (req, res) => {
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, role, department, title, phone, avatar_initials, employee_code, hire_date, company_id, emergency_contact"
    )
    .eq("id", req.user.id)
    .single();

  const today = new Date().toISOString().split("T")[0];
  const { data: todayAtt } = await supabase
    .from("attendance")
    .select("status, check_in, check_out")
    .eq("employee_id", req.user.id)
    .eq("date", today)
    .single();

  // ✅ FIX: Always fetch fresh plan from DB (so plan changes by super admin reflect immediately)
  let plan = null;
  const companyId = profile?.company_id || req.user.company_id;
  if (companyId) {
    const { data: sub } = await supabase
      .from("company_subscriptions")
      .select("status, trial_ends, billing_end, plans(name, display_name, features, max_employees)")
      .eq("company_id", companyId)
      .single();

    if (sub && sub.plans) {
      plan = {
        ...sub.plans,
        status:      sub.status,
        trial_ends:  sub.trial_ends,
        billing_end: sub.billing_end,
      };
    } else {
      // Fallback to companies.plan (updated by super admin)
      const { data: co } = await supabase
        .from("companies")
        .select("plan")
        .eq("id", companyId)
        .single();

      if (co?.plan) {
        plan = { name: co.plan, display_name: co.plan, status: "active" };
      }
    }
  }

  res.json({
    success: true,
    user: {
      id:    req.user.id,
      email: req.user.email,
      ...profile,
      plan,
      today: todayAtt || null,
    },
  });
});

exports.logout = asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) await supabase.auth.admin.signOut(token).catch(() => {});
  res.json({ success: true, message: "Logged out" });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: req.user.email,
    password: current_password,
  });
  if (authErr)
    return res.status(400).json({ success: false, error: "Current password is incorrect" });

  const { error } = await supabase.auth.admin.updateUserById(req.user.id, {
    password: new_password,
  });
  if (error) return res.status(400).json({ success: false, error: error.message });

  res.json({ success: true, message: "Password updated successfully" });
});

exports.onboardCompany = asyncHandler(async (req, res) => {
  const {
    company, industry, size, timezone, officeAddr, lat, lng, radius,
    adminName, adminEmail, adminPassword,
  } = req.body;

  if (!company || !adminEmail || !adminPassword)
    return res.status(400).json({
      success: false,
      error: "Company name, admin email and password are required",
    });

  // 1. Create company record
  const { data: co, error: coErr } = await supabase
    .from("companies")
    .insert({ name: company, industry, size, timezone: timezone || "Asia/Kolkata" })
    .select()
    .single();
  if (coErr) return res.status(400).json({ success: false, error: coErr.message });

  // 2. Create office location if coords provided
  if (lat && lng) {
    await supabase.from("office_locations").insert({
      company_id: co.id,
      name:       officeAddr || "Head Office",
      lat:        parseFloat(lat),
      lng:        parseFloat(lng),
      radius_m:   parseInt(radius) || 100,
    });
  }

  // 3. Create admin auth user
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: adminEmail, password: adminPassword, email_confirm: true,
    user_metadata: { full_name: adminName },
  });
  if (authErr) {
    await supabase.from("companies").delete().eq("id", co.id);
    return res.status(400).json({ success: false, error: authErr.message });
  }

  // 4. Update profile with admin role + company_id
  await supabase.from("profiles").update({
    role:             "admin",
    full_name:        adminName,
    company_id:       co.id,
    is_active:        true,
    avatar_initials:  adminName
      ? adminName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
      : "AD",
  }).eq("id", authData.user.id);

  // 5. Seed default leave types for this company
  const defaultLeaves = [
    { company_id: co.id, name: "Annual Leave",   default_days: 18, is_paid: true,  carry_forward: true  },
    { company_id: co.id, name: "Sick Leave",      default_days: 12, is_paid: true,  carry_forward: false },
    { company_id: co.id, name: "Casual Leave",    default_days: 6,  is_paid: true,  carry_forward: false },
    { company_id: co.id, name: "Maternity Leave", default_days: 90, is_paid: true,  carry_forward: false },
    { company_id: co.id, name: "Unpaid Leave",    default_days: 0,  is_paid: false, carry_forward: false },
  ];
  const { data: ltypes } = await supabase.from("leave_types").insert(defaultLeaves).select();

  // 6. Seed leave balances for admin
  if (ltypes?.length) {
    const year     = new Date().getFullYear();
    const balances = ltypes.map(t => ({
      employee_id:   authData.user.id,
      leave_type_id: t.id,
      year,
      total_days:    t.default_days,
      used_days:     0,
      pending_days:  0,
    }));
    await supabase.from("leave_balances").upsert(balances, {
      onConflict: "employee_id,leave_type_id,year",
    });
  }

  res.status(201).json({
    success: true,
    message: "Company onboarded successfully",
    company: { id: co.id, name: co.name },
    admin:   { id: authData.user.id, email: adminEmail, name: adminName },
  });
});
exports.updateProfile = asyncHandler(async (req, res) => {
  const { id } = req.user;
  const allowed = ["address","pan_number","aadhaar_number","bank_account_number","bank_ifsc","bank_name","bank_account_holder"];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { error } = await supabase.from("profiles").update(updates).eq("id", id);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: "Profile updated" });
});