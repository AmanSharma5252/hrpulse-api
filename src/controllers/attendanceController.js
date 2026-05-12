const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");
const { validateGPS, getOfficeLocation } = require("../utils/gps");

const todayStr  = () => new Date().toISOString().split("T")[0];
const getStatus = t  => (t.getHours() > 9 || (t.getHours() === 9 && t.getMinutes() > 30)) ? "late" : "present";

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

exports.getMyAttendance = asyncHandler(async (req, res) => {
  const now   = new Date();
  const month = parseInt(req.query.month || now.getMonth() + 1);
  const year  = parseInt(req.query.year  || now.getFullYear());
  const limit = parseInt(req.query.limit || 31);
  const from  = `${year}-${String(month).padStart(2,"0")}-01`;
  const to    = `${year}-${String(month).padStart(2,"0")}-31`;

  const { data, error } = await supabase.from("attendance").select("*")
    .eq("employee_id", req.user.id)
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

  const { data } = await supabase.from("attendance").select("status, work_minutes")
    .eq("employee_id", req.user.id).gte("date", from).lte("date", to);

  res.json({ success: true, summary: {
    present:       (data||[]).filter(r => r.status === "present").length,
    late:          (data||[]).filter(r => r.status === "late").length,
    absent:        (data||[]).filter(r => r.status === "absent").length,
    on_leave:      (data||[]).filter(r => r.status === "on-leave").length,
    total_minutes: (data||[]).reduce((s, r) => s + (r.work_minutes || 0), 0),
  }});
});

exports.checkIn = asyncHandler(async (req, res) => {
  const { id: userId, company_id } = req.user;
  const date = todayStr();

  const { data: existing } = await supabase.from("attendance")
    .select("id, check_in").eq("employee_id", userId).eq("date", date).single();
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
    employee_id: userId, company_id, date,
    check_in: now.toISOString(), latitude: lat || null, longitude: lng || null,
    selfie_in, status, note: req.body.note || null,
  }, { onConflict: "employee_id,date" }).select().single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  req.app.get("io")?.to(`co_${company_id}`).emit("attendance", { type: "check_in", user: req.user.name, status, time: now });
  res.json({ success: true, message: `Clocked in — ${status}`, record: data });
});

exports.checkOut = asyncHandler(async (req, res) => {
  const { id: userId, company_id } = req.user;
  const date = todayStr();

  const { data: existing } = await supabase.from("attendance")
    .select("id, check_in, check_out").eq("employee_id", userId).eq("date", date).single();
  if (!existing?.check_in)  return res.status(400).json({ success: false, error: "You have not clocked in today" });
  if (existing?.check_out)  return res.status(400).json({ success: false, error: "Already clocked out today" });

  const { latitude: lat, longitude: lng } = req.body;
  const now  = new Date();
  const mins = Math.round((now - new Date(existing.check_in)) / 60000);

  const { data, error } = await supabase.from("attendance").update({
    check_out: now.toISOString(), check_out_lat: lat || null, check_out_lng: lng || null,
    work_minutes: Math.max(0, mins),
  }).eq("id", existing.id).select().single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  req.app.get("io")?.to(`co_${company_id}`).emit("attendance", { type: "check_out", user: req.user.name, work_minutes: mins });
  res.json({ success: true, message: "Clocked out successfully", work_minutes: mins, record: data });
});

exports.getTeamAttendance = asyncHandler(async (req, res) => {
  const date         = req.query.date || todayStr();
  const { company_id } = req.user;

  const { data: records } = await supabase
    .from("attendance")
    .select("*, profiles!attendance_employee_id_fkey(full_name, department, avatar_initials)")
    .eq("company_id", company_id).eq("date", date)
    .order("check_in", { ascending: true });

  const shaped = (records||[]).map(r => ({
    ...r,
    employee: r.profiles
      ? { name: r.profiles.full_name, department: r.profiles.department, avatar_initials: r.profiles.avatar_initials }
      : null,
  }));

  const present = shaped.filter(r => r.status === "present").length;
  const late    = shaped.filter(r => r.status === "late").length;
  const onLeave = shaped.filter(r => r.status === "on-leave").length;
  const { count: total } = await supabase.from("profiles")
    .select("*", { count: "exact", head: true }).eq("company_id", company_id).eq("is_active", true);

  res.json({ success: true, date, records: shaped,
    summary: { present, late, on_leave: onLeave, absent: Math.max(0,(total||0)-present-late-onLeave), total: total||0, rate: total ? Math.round((present+late)/total*100) : 0 } });
});
