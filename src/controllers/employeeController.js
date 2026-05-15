const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

exports.list = asyncHandler(async (req, res) => {
  const { company_id, role } = req.user;
  const { is_active = "true", limit = 500 } = req.query;
  const isSuperAdmin = role === "super_admin";

  let q = supabase.from("profiles").select("*", { count: "exact" })
    .order("full_name").limit(+limit);
  if (!isSuperAdmin) q = q.eq("company_id", company_id);
  if (is_active !== "all") q = q.eq("is_active", is_active === "true");

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ success: false, error: error.message });

  const employees = (data || []).map(p => ({
    id:                p.id,
    employee_code:     p.employee_code,
    name:              p.full_name,
    email:             "",
    role:              p.role,
    department:        p.department,
    title:             p.title,
    phone:             p.phone,
    emergency_contact: p.emergency_contact,
    avatar_initials:   p.avatar_initials,
    hire_date:         p.hire_date,
    is_active:         p.is_active,
    company_id:        p.company_id,
  }));

  res.json({ success: true, employees, total: count });
});

exports.create = asyncHandler(async (req, res) => {
  const {
    email, password, name, role, department,
    title, phone, emergency_contact, hire_date, company_id,
  } = req.body;

  const companyId       = company_id || req.user.company_id || null;
  const avatarInitials  = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // ── 1. Create Supabase Auth user ──────────────────────────────────────────
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (authError) return res.status(400).json({ success: false, error: authError.message });

  const authUserId = authData.user.id; // ← this is the UUID we must link everywhere

  // ── 2. Update profiles table (trigger may have already inserted a row) ────
  const { error: profileError } = await supabase.from("profiles").update({
    full_name:         name,
    role:              role || "employee",
    department:        department   || null,
    title:             title        || null,
    phone:             phone        || null,
    emergency_contact: emergency_contact || null,
    hire_date:         hire_date    || null,
    company_id:        companyId,
    avatar_initials:   avatarInitials,
    is_active:         true,
  }).eq("id", authUserId);

  if (profileError) {
    console.error("Warning: Could not update profiles table:", profileError.message);
  }

  // ── 3. ✅ FIX: Upsert into employees table WITH user_id = authUserId ──────
  //    This is the column that attendance / dashboard controllers use to look
  //    up the employee for the logged-in user.  Without it the FK join fails
  //    and the "Employee record not found" error is thrown.
  const { data: empRow, error: empErr } = await supabase
    .from("employees")
    .upsert(
      {
        user_id:           authUserId,   // ← THE CRITICAL LINK
        name,
        email,
        role:              role              || "employee",
        department:        department        || null,
        title:             title             || null,
        phone:             phone             || null,
        emergency_contact: emergency_contact || null,
        hire_date:         hire_date         || null,
        avatar_initials:   avatarInitials,
        company_id:        companyId,
        is_active:         true,
      },
      { onConflict: "user_id" }          // safe to re-run; won't duplicate
    )
    .select("id")
    .single();

  if (empErr) {
    // Log the real error so you can see it in server logs
    console.error("ERROR: Could not upsert into employees table:", empErr.message);
    // Return a clear error instead of silently continuing — otherwise
    // checkin/attendance will keep returning 400 "Employee record not found"
    return res.status(500).json({
      success: false,
      error:   "Employee auth account was created but employee profile could not be saved. " +
               "Please check your employees table schema. Detail: " + empErr.message,
    });
  }

  const employeeTableId = empRow?.id || null;

  // ── 4. Seed leave balances (keyed on authUserId = profiles FK) ───────────
  const { data: ltypes } = await supabase.from("leave_types").select("id, default_days");
  if (ltypes?.length) {
    const year     = new Date().getFullYear();
    const balances = ltypes.map(t => ({
      employee_id:   authUserId,
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
    success:  true,
    message:  "Employee created",
    employee: {
      id:                authUserId,
      employee_table_id: employeeTableId,
      employee_code:     "—",
      name,
      email,
      role:              role || "employee",
      department,
      title,
      phone,
      emergency_contact,
      avatar_initials:   avatarInitials,
      hire_date,
      is_active:         true,
    },
  });
});

exports.update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, role, department, title, phone, emergency_contact, hire_date } = req.body;

  if (role === "super_admin" && req.user.role !== "super_admin") {
    return res.status(403).json({ success: false, error: "Only super_admin can assign super_admin role" });
  }

  // ── Update profiles ───────────────────────────────────────────────────────
  const profileUpdates = { updated_at: new Date().toISOString() };
  if (name)                       profileUpdates.full_name          = name;
  if (role)                       profileUpdates.role               = role;
  if (department        != null)  profileUpdates.department         = department;
  if (title             != null)  profileUpdates.title              = title;
  if (phone             != null)  profileUpdates.phone              = phone;
  if (emergency_contact != null)  profileUpdates.emergency_contact  = emergency_contact;
  if (hire_date         != null)  profileUpdates.hire_date          = hire_date;

  const { data, error } = await supabase
    .from("profiles").update(profileUpdates).eq("id", id).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });

  // ── ✅ FIX: Update employees table matched by user_id (not employees.id) ──
  const empUpdates = {};
  if (name)              empUpdates.name              = name;
  if (role)              empUpdates.role              = role;
  if (department)        empUpdates.department        = department;
  if (title)             empUpdates.title             = title;
  if (phone)             empUpdates.phone             = phone;
  if (emergency_contact) empUpdates.emergency_contact = emergency_contact;
  if (hire_date)         empUpdates.hire_date         = hire_date;

  if (Object.keys(empUpdates).length) {
    // Match on user_id column, not the employees primary key
    const { error: empUpdateErr } = await supabase
      .from("employees").update(empUpdates).eq("user_id", id);
    if (empUpdateErr) {
      console.error("Warning: employees table update failed:", empUpdateErr.message);
    }
  }

  res.json({
    success:  true,
    message:  "Updated",
    employee: {
      id,
      employee_code:     data.employee_code,
      name:              data.full_name,
      role:              data.role,
      department:        data.department,
      title:             data.title,
      phone:             data.phone,
      emergency_contact: data.emergency_contact,
      avatar_initials:   data.avatar_initials,
      hire_date:         data.hire_date,
      is_active:         data.is_active,
    },
  });
});

exports.deactivate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ success: false, error: "Cannot deactivate yourself" });
  }

  // Deactivate in both tables — employees matched by user_id
  await supabase.from("profiles").update({ is_active: false }).eq("id", id);
  await supabase.from("employees").update({ is_active: false }).eq("user_id", id);

  res.json({ success: true, message: "Employee deactivated" });
});