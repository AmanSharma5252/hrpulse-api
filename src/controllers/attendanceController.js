const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");
const { validateGPS, getOfficeLocation } = require("../utils/gps");

const todayStr  = () => new Date().toISOString().split("T")[0];
const getStatus = t  => (t.getHours() > 9 || (t.getHours() === 9 && t.getMinutes() > 30)) ? "late" : "present";

// Work day = 8 hours = 480 minutes
const WORK_DAY_MINUTES = 480;

async function uploadSelfie(base64, userId, type = "in") {
  if (!base64) return null;
  try {
    const buf  = Buffer.from(base64, "base64");
    const path = `selfies/${userId}/${Date.now()}_${type}.jpg`;
    const { error } = await supabase.storage.from("hrpulse-assets").upload(path, buf, { contentType: "image/jpeg", upsert: false });
    if (error) return null;
    const { data } = supabase.storage.from("hrpulse-assets").getPublicUrl(path);
    return data?.publicUrl || null;
  } catch { return null; }
}

// Resolve correct employee_id for attendance FK (points to employees.id)
async function resolveEmployeeId(authUserId, userEmail) {
  // First try by email
  if (userEmail) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("email", userEmail)
      .single();
    if (emp?.id) return { id: emp.id, found: true };
  }
  // Then try by auth user id directly
  const { data: empById } = await supabase
    .from("employees")
    .select("id")
    .eq("id", authUserId)
    .single();
  if (empById?.id) return { id: empById.id, found: true };
  // Last resort: auto-create employee record from profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, department, company_id, avatar_initials")
    .eq("id", authUserId)
    .single();
  if (profile && userEmail) {
    const { data: newEmp } = await supabase.from("employees").insert({
      name:            profile.full_name || userEmail,
      email:           userEmail,
      role:            profile.role || "employee",
      department:      profile.department || null,
      avatar_initials: profile.avatar_initials || "?",
      company_id:      profile.company_id || null,
      is_active:       true,
      password_hash:   "",
    }).select("id").single();
    if (newEmp?.id) {
      console.log("Auto-created employee record for:", userEmail);
      return { id: newEmp.id, found: true };
    }
  }
  return { id: authUserId, found: false };
}

exports.getMyAttendance = asyncHandler(async (req, res) => {
  const now   = new Date();
  const month = parseInt(req.query.month || now.getMonth() + 1);
  const year  = parseInt(req.query.year  || now.getFullYear());
  const limit = parseInt(req.query.limit || 31);
  const from  = `${year}-${String(month).padStart(2,"0")}-01`;
  const to    = `${year}-${String(month).padStart(2,"0")}-31`;

  const { id: employeeId } = await resolveEmployeeId(req.user.id, req.user.email);

  const { data, error } = await supabase.from("attendance").select("*")
    .eq("employee_id", employeeId)
    .gte("date", from).lte("date", to)
    .order("date", { ascending: false }).limit(limit);

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, records: data || [] });
});

exports.getMySummary = asyncHandler(async (req, res) => {
  const now   = new Date();
  const month = parseInt(req.query.month || now.getMonth() + 1);
  const year  = parseInt(req.query.year  || now.getFullYear());
  const from  = `${year}-${String(month).padStart(2,"0")}-01`;
  const to    = `${year}-${String(month).padStart(2,"0")}-31`;

  const { id: employeeId } = await resolveEmployeeId(req.user.id, req.user.email);

  const { data } = await supabase.from("attendance").select("status, work_minutes")
    .eq("employee_id", employeeId).gte("date", from).lte("date", to);

  res.json({ success: true, summary: {
    present:       (data||[]).filter(r => r.status === "present").length,
    late:          (data||[]).filter(r => r.status === "late").length,
    absent:        (data||[]).filter(r => r.status === "absent").length,
    on_leave:      (data||[]).filter(r => r.status === "on-leave").length,
    total_minutes: (data||[]).reduce((s, r) => s + (r.work_minutes || 0), 0),
  }});
});

exports.checkIn = asyncHandler(async (req, res) => {
  const { id: userId, company_id, email } = req.user;
  const date = todayStr();

  const { id: employeeId, found } = await resolveEmployeeId(userId, email);
  if (!found) {
    return res.status(400).json({
      success: false,
      error: "Employee record not found. Please ask your administrator to re-add you as an employee.",
    });
  }

  const { data: existing } = await supabase.from("attendance")
    .select("id, check_in")
    .eq("employee_id", employeeId)
    .eq("date", date)
    .single();
  if (existing?.check_in) return res.status(400).json({ success: false, error: "Already clocked in today" });

  const { latitude: lat, longitude: lng } = req.body;
  if (lat != null && lng != null) {
    const office = await getOfficeLocation(supabase, company_id);
    if (office) {
      const { valid, distance } = validateGPS(office.lat, office.lng, lat, lng, office.radius_m);
      if (!valid) return res.status(400).json({ success: false, error: `You are ${distance}m from the office (limit: ${office.radius_m}m)` });
    }
  }

  const selfie_in = await uploadSelfie(req.body.selfie_base64, userId, "in");
  const now       = new Date();
  const status    = getStatus(now);

  const { data, error } = await supabase.from("attendance").upsert({
    employee_id: employeeId,
    company_id,
    date,
    check_in:  now.toISOString(),
    latitude:  lat || null,
    longitude: lng || null,
    selfie_in,
    status,
    note: req.body.note || null,
  }, { onConflict: "employee_id,date" }).select().single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  req.app.get("io")?.to(`co_${company_id}`).emit("attendance", { type: "check_in", user: req.user.name, status, time: now });
  res.json({ success: true, message: `Clocked in — ${status}`, record: data });
});

exports.checkOut = asyncHandler(async (req, res) => {
  const { id: userId, company_id, email } = req.user;
  const date = todayStr();

  const { id: employeeId, found } = await resolveEmployeeId(userId, email);
  if (!found) {
    return res.status(400).json({
      success: false,
      error: "Employee record not found. Please ask your administrator to re-add you as an employee.",
    });
  }

  const { data: existing } = await supabase.from("attendance")
    .select("id, check_in, check_out")
    .eq("employee_id", employeeId)
    .eq("date", date)
    .single();
  if (!existing?.check_in) return res.status(400).json({ success: false, error: "You have not clocked in today" });
  if (existing?.check_out) return res.status(400).json({ success: false, error: "Already clocked out today" });

  const { latitude: lat, longitude: lng, early_checkout_reason } = req.body;
  const now  = new Date();
  const mins = Math.round((now - new Date(existing.check_in)) / 60000);

  // ✅ EARLY CHECKOUT LOGIC
  const isEarly = mins < WORK_DAY_MINUTES;

  // If early and no reason provided — reject and ask for reason
  if (isEarly && !early_checkout_reason) {
    const workedH = Math.floor(mins / 60);
    const workedM = mins % 60;
    const remainH = Math.floor((WORK_DAY_MINUTES - mins) / 60);
    const remainM = (WORK_DAY_MINUTES - mins) % 60;
    return res.status(400).json({
      success: false,
      early_checkout: true,   // ← frontend uses this flag to show reason modal
      worked_minutes: mins,
      remaining_minutes: WORK_DAY_MINUTES - mins,
      error: `You have only worked ${workedH}h ${workedM}m. Full shift is 8 hours (${remainH}h ${remainM}m remaining). Please provide a reason for early checkout.`,
    });
  }

  // Build update payload — remove check_out_lat/lng since columns don't exist
  const updatePayload = {
    check_out:            now.toISOString(),
    early_checkout:       isEarly,
    early_checkout_reason: isEarly ? (early_checkout_reason || null) : null,
  };

  const { data, error } = await supabase.from("attendance")
    .update(updatePayload)
    .eq("id", existing.id)
    .select()
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  req.app.get("io")?.to(`co_${company_id}`).emit("attendance", {
    type: "check_out", user: req.user.name, work_minutes: mins, early_checkout: isEarly,
  });

  res.json({
    success: true,
    message: isEarly
      ? `Early checkout recorded — ${Math.floor(mins/60)}h ${mins%60}m worked`
      : `Clocked out successfully — ${Math.floor(mins/60)}h ${mins%60}m worked`,
    work_minutes: mins,
    early_checkout: isEarly,
    record: data,
  });
});

exports.getTeamAttendance = asyncHandler(async (req, res) => {
  const date           = req.query.date || todayStr();
  const { company_id } = req.user;

  const { data: records } = await supabase
    .from("attendance")
    .select("*, employees!attendance_employee_id_fkey(name, department, avatar_initials)")
    .eq("company_id", company_id).eq("date", date)
    .order("check_in", { ascending: true });

  const shaped = (records||[]).map(r => ({
    ...r,
    employee: r.employees
      ? { name: r.employees.name, department: r.employees.department, avatar_initials: r.employees.avatar_initials }
      : null,
  }));

  const present = shaped.filter(r => r.status === "present").length;
  const late    = shaped.filter(r => r.status === "late").length;
  const onLeave = shaped.filter(r => r.status === "on-leave").length;
  const { count: total } = await supabase.from("profiles")
    .select("*", { count: "exact", head: true }).eq("company_id", company_id).eq("is_active", true);

  res.json({
    success: true, date, records: shaped,
    summary: {
      present, late, on_leave: onLeave,
      absent: Math.max(0, (total||0) - present - late - onLeave),
      total: total||0,
      rate: total ? Math.round((present + late) / total * 100) : 0,
    },
  });
});