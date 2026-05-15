const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");
const { validateGPS, getOfficeLocation } = require("../utils/gps");

const todayStr  = () => {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().split("T")[0];
};
const getStatus = t => (t.getHours() > 9 || (t.getHours() === 9 && t.getMinutes() > 30)) ? "late" : "present";

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

// ✅ Resolve employee_id — tries user_id first (the correct FK after our fix),
//    then falls back to email, then id match, then auto-creates.
async function resolveEmployeeId(authUserId, userEmail) {
  // 1. Match by user_id (correct after employeeController fix)
  const { data: empByUserId } = await supabase
    .from("employees").select("id").eq("user_id", authUserId).single();
  if (empByUserId?.id) return empByUserId.id;

  // 2. Fallback: match by email
  if (userEmail) {
    const { data: empByEmail } = await supabase
      .from("employees").select("id").eq("email", userEmail).single();
    if (empByEmail?.id) return empByEmail.id;
  }

  // 3. Fallback: match by id directly
  const { data: empById } = await supabase
    .from("employees").select("id").eq("id", authUserId).single();
  if (empById?.id) return empById.id;

  // 4. Last resort: auto-create employee row from profile
  const { data: profile } = await supabase
    .from("profiles").select("full_name, role, department, company_id, avatar_initials")
    .eq("id", authUserId).single();
  if (profile && userEmail) {
    const empCode = "EMP-" + authUserId.substring(0, 6).toUpperCase();
    const { data: newEmp } = await supabase.from("employees").insert({
      user_id:         authUserId,         // ← link correctly
      name:            profile.full_name || userEmail,
      email:           userEmail,
      role:            profile.role       || "employee",
      department:      profile.department || null,
      avatar_initials: profile.avatar_initials || "?",
      company_id:      profile.company_id || null,
      is_active:       true,
      password_hash:   "",
      employee_code:   empCode,
    }).select("id").single();
    if (newEmp?.id) return newEmp.id;
  }

  // Final fallback
  return authUserId;
}

// ✅ Helper: calculate live worked minutes from check_in time
function calcWorkedMinutes(checkInIso) {
  return Math.round((Date.now() - new Date(checkInIso).getTime()) / 60000);
}

exports.getMyAttendance = asyncHandler(async (req, res) => {
  const now   = new Date();
  const month = parseInt(req.query.month || now.getMonth() + 1);
  const year  = parseInt(req.query.year  || now.getFullYear());
  const limit = parseInt(req.query.limit || 31);
  const from  = `${year}-${String(month).padStart(2, "0")}-01`;
  const to    = `${year}-${String(month).padStart(2, "0")}-31`;

  const employeeId = await resolveEmployeeId(req.user.id, req.user.email);

  const { data, error } = await supabase.from("attendance").select("*")
    .eq("employee_id", employeeId)
    .gte("date", from).lte("date", to)
    .order("date", { ascending: false }).limit(limit);

  if (error) return res.status(500).json({ success: false, error: error.message });

  // ✅ FIX: For today's open record (no check_out), compute live work_minutes
  const records = (data || []).map(r => {
    if (r.check_in && !r.check_out) {
      return { ...r, work_minutes: calcWorkedMinutes(r.check_in) };
    }
    return r;
  });

  res.json({ success: true, records });
});

exports.getMySummary = asyncHandler(async (req, res) => {
  const now   = new Date();
  const month = parseInt(req.query.month || now.getMonth() + 1);
  const year  = parseInt(req.query.year  || now.getFullYear());
  const from  = `${year}-${String(month).padStart(2, "0")}-01`;
  const to    = `${year}-${String(month).padStart(2, "0")}-31`;

  const employeeId = await resolveEmployeeId(req.user.id, req.user.email);

  const { data } = await supabase.from("attendance").select("status, work_minutes, check_in, check_out")
    .eq("employee_id", employeeId).gte("date", from).lte("date", to);

  // ✅ FIX: Count live minutes for any open record today
  const totalMinutes = (data || []).reduce((sum, r) => {
    if (r.check_in && !r.check_out) return sum + calcWorkedMinutes(r.check_in);
    return sum + (r.work_minutes || 0);
  }, 0);

  res.json({
    success: true,
    summary: {
      present:       (data || []).filter(r => r.status === "present").length,
      late:          (data || []).filter(r => r.status === "late").length,
      absent:        (data || []).filter(r => r.status === "absent").length,
      on_leave:      (data || []).filter(r => r.status === "on-leave").length,
      total_minutes: totalMinutes,
    },
  });
});

exports.checkIn = asyncHandler(async (req, res) => {
  const { id: userId, company_id, email } = req.user;
  const date = todayStr();

  const employeeId = await resolveEmployeeId(userId, email);

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
    note:        req.body.note || null,
    work_minutes: 0,   // initialise to 0; will be updated on checkout
  }, { onConflict: "employee_id,date" }).select().single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  req.app.get("io")?.to(`co_${company_id}`).emit("attendance", {
    type: "check_in", user: req.user.name, status, time: now,
  });

  res.json({ success: true, message: `Clocked in — ${status}`, record: data });
});

exports.checkOut = asyncHandler(async (req, res) => {
  const { id: userId, company_id, email } = req.user;
  const date = todayStr();

  const employeeId = await resolveEmployeeId(userId, email);

  const { data: existing } = await supabase.from("attendance")
    .select("id, check_in, check_out")
    .eq("employee_id", employeeId)
    .eq("date", date)
    .single();

  if (!existing?.check_in)  return res.status(400).json({ success: false, error: "You have not clocked in today" });
  if (existing?.check_out)  return res.status(400).json({ success: false, error: "Already clocked out today" });

  const { latitude: lat, longitude: lng, early_checkout_reason } = req.body;
  const now  = new Date();
  const mins = Math.round((now - new Date(existing.check_in)) / 60000);

  const isEarly = mins < WORK_DAY_MINUTES;

  // If early and no reason — ask frontend to collect reason
  if (isEarly && !early_checkout_reason) {
    const workedH = Math.floor(mins / 60);
    const workedM = mins % 60;
    const remainH = Math.floor((WORK_DAY_MINUTES - mins) / 60);
    const remainM = (WORK_DAY_MINUTES - mins) % 60;
    return res.status(400).json({
      success:           false,
      early_checkout:    true,       // ← frontend shows reason modal on this flag
      worked_minutes:    mins,
      remaining_minutes: WORK_DAY_MINUTES - mins,
      error: `You have only worked ${workedH}h ${workedM}m. Full shift is 8 hours (${remainH}h ${remainM}m remaining). Please provide a reason for early checkout.`,
    });
  }

  // ✅ FIX: Save work_minutes to DB so dashboard shows correct hours worked
  const updatePayload = {
    check_out:             now.toISOString(),
    work_minutes:          mins,          // ← THIS was missing before
    early_checkout:        isEarly,
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
    success:        true,
    message:        isEarly
      ? `Early checkout recorded — ${Math.floor(mins / 60)}h ${mins % 60}m worked`
      : `Clocked out successfully — ${Math.floor(mins / 60)}h ${mins % 60}m worked`,
    work_minutes:   mins,
    early_checkout: isEarly,
    record:         data,
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

  const shaped = (records || []).map(r => ({
    ...r,
    // ✅ FIX: live minutes for open records in team view too
    work_minutes: (r.check_in && !r.check_out) ? calcWorkedMinutes(r.check_in) : r.work_minutes,
    employee: r.employees
      ? { name: r.employees.name, department: r.employees.department, avatar_initials: r.employees.avatar_initials }
      : null,
  }));

  const present = shaped.filter(r => r.status === "present").length;
  const late    = shaped.filter(r => r.status === "late").length;
  const onLeave = shaped.filter(r => r.status === "on-leave").length;
  const { count: total } = await supabase.from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("company_id", company_id).eq("is_active", true);

  res.json({
    success: true,
    date,
    records: shaped,
    summary: {
      present, late, on_leave: onLeave,
      absent: Math.max(0, (total || 0) - present - late - onLeave),
      total:  total || 0,
      rate:   total ? Math.round((present + late) / total * 100) : 0,
    },
  });
});