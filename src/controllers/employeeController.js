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
    base_salary:       p.base_salary != null ? +p.base_salary : 0,
    hra_pct:           p.hra_pct     != null ? +p.hra_pct     : 0,
    ta_amount:         p.ta_amount   != null ? +p.ta_amount   : 0,
    pf_pct:            p.pf_pct      != null ? +p.pf_pct      : 0,
    tax_pct:           p.tax_pct     != null ? +p.tax_pct     : 0,
  }));

  res.json({ success: true, employees, total: count });
});

exports.create = asyncHandler(async (req, res) => {
  const {
    email, password, name, role, department,
    title, phone, emergency_contact, hire_date, company_id,
  } = req.body;

  const companyId      = company_id || req.user.company_id || null;
  const avatarInitials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (authError) return res.status(400).json({ success: false, error: authError.message });

  const authUserId = authData.user.id;

  const { error: profileError } = await supabase.from("profiles").update({
    full_name:         name,
    role:              role || "employee",
    department:        department        || null,
    title:             title             || null,
    phone:             phone             || null,
    emergency_contact: emergency_contact || null,
    hire_date:         hire_date         || null,
    company_id:        companyId,
    avatar_initials:   avatarInitials,
    is_active:         true,
  }).eq("id", authUserId);

  if (profileError) {
    console.error("Warning: Could not update profiles table:", profileError.message);
  }

  const { data: empRow, error: empErr } = await supabase
    .from("employees")
    .upsert(
      {
        user_id:           authUserId,
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
      { onConflict: "user_id" }
    )
    .select("id")
    .single();

  if (empErr) {
    console.error("ERROR: Could not upsert into employees table:", empErr.message);
    return res.status(500).json({
      success: false,
      error:   "Employee auth account was created but employee profile could not be saved. " +
               "Please check your employees table schema. Detail: " + empErr.message,
    });
  }

  const employeeTableId = empRow?.id || null;

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
      base_salary:       0,
      hra_pct:           0,
      ta_amount:         0,
      pf_pct:            0,
      tax_pct:           0,
    },
  });
});

exports.update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name, title, phone, department, role,
    hire_date, emergency_contact,
    base_salary, hra_pct, ta_amount, pf_pct, tax_pct,
  } = req.body;

  // Build profile updates — only include fields that were actually sent
  const profileUpdates = {};
  if (name              !== undefined) {
    profileUpdates.full_name       = name;
    profileUpdates.avatar_initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  }
  if (title             !== undefined) profileUpdates.title             = title;
  if (phone             !== undefined) profileUpdates.phone             = phone;
  if (department        !== undefined) profileUpdates.department        = department;
  if (role              !== undefined) profileUpdates.role              = role;
  if (hire_date         !== undefined) profileUpdates.hire_date         = hire_date;
  if (emergency_contact !== undefined) profileUpdates.emergency_contact = emergency_contact;
  if (base_salary       !== undefined) profileUpdates.base_salary       = +base_salary;
  if (hra_pct           !== undefined) profileUpdates.hra_pct           = +hra_pct;
  if (ta_amount         !== undefined) profileUpdates.ta_amount         = +ta_amount;
  if (pf_pct            !== undefined) profileUpdates.pf_pct            = +pf_pct;
  if (tax_pct           !== undefined) profileUpdates.tax_pct           = +tax_pct;

  if (!Object.keys(profileUpdates).length) {
    return res.status(400).json({ success: false, error: "No fields provided to update" });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(profileUpdates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  // Sync basic fields to employees table as well (excludes salary fields — not stored there)
  const empUpdates = {};
  if (name              !== undefined) empUpdates.name              = name;
  if (title             !== undefined) empUpdates.title             = title;
  if (phone             !== undefined) empUpdates.phone             = phone;
  if (department        !== undefined) empUpdates.department        = department;
  if (role              !== undefined) empUpdates.role              = role;
  if (hire_date         !== undefined) empUpdates.hire_date         = hire_date;
  if (emergency_contact !== undefined) empUpdates.emergency_contact = emergency_contact;

  if (Object.keys(empUpdates).length) {
    await supabase.from("employees").update(empUpdates).eq("user_id", id);
  }

  res.json({
    success:  true,
    message:  "Employee updated",
    employee: {
      id:                data.id,
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
      company_id:        data.company_id,
      base_salary:       data.base_salary != null ? +data.base_salary : 0,
      hra_pct:           data.hra_pct     != null ? +data.hra_pct     : 0,
      ta_amount:         data.ta_amount   != null ? +data.ta_amount   : 0,
      pf_pct:            data.pf_pct      != null ? +data.pf_pct      : 0,
      tax_pct:           data.tax_pct     != null ? +data.tax_pct     : 0,
    },
  });
});

exports.deactivate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ success: false, error: "Cannot deactivate yourself" });
  }

  await supabase.from("profiles").update({ is_active: false }).eq("id", id);
  await supabase.from("employees").update({ is_active: false }).eq("user_id", id);

  res.json({ success: true, message: "Employee deactivated" });
});

exports.getEmployeeProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("profiles")
    .select("bank_account_number, bank_ifsc, bank_name, bank_account_holder, address, pan_number, aadhaar_number")
    .eq("id", id)
    .single();
  if (error) return res.status(404).json({ success: false, error: "Profile not found" });
  res.json({ success: true, profile: data });
});