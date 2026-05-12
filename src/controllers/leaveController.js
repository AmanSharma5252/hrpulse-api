const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

const calcDays = (from, to) => Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5) + 1);

exports.getTypes = asyncHandler(async (req, res) => {
  const { data } = await supabase.from("leave_types").select("*").order("name");
  res.json({ success: true, leave_types: data||[] });
});

exports.getBalances = asyncHandler(async (req, res) => {
  const year = new Date().getFullYear();
  const { data } = await supabase.from("leave_balances")
    .select("*, leave_type:leave_types(name, is_paid)")
    .eq("employee_id", req.user.id).eq("year", year);
  res.json({ success: true, balances: data||[] });
});

exports.getMy = asyncHandler(async (req, res) => {
  const { data } = await supabase.from("leave_requests")
    .select("*, leave_type:leave_types(name), reviewer:reviewed_by(full_name)")
    .eq("employee_id", req.user.id)
    .order("created_at", { ascending: false }).limit(100);

  const shaped = (data||[]).map(l => ({
    ...l,
    employee: { name: req.user.name, avatar_initials: req.user.avatar, department: req.user.dept },
  }));
  res.json({ success: true, requests: shaped });
});

exports.getAll = asyncHandler(async (req, res) => {
  const { company_id }    = req.user;
  const { limit = 500, status } = req.query;

  let q = supabase.from("leave_requests")
    .select("*, leave_type:leave_types(name), employee:profiles!leave_requests_employee_id_fkey(full_name,department,avatar_initials), reviewer:reviewed_by(full_name)")
    .eq("company_id", company_id)
    .order("created_at", { ascending: false }).limit(+limit);
  if (status) q = q.eq("status", status);

  const { data } = await q;
  const shaped = (data||[]).map(l => ({
    ...l,
    employee: l.employee ? { name: l.employee.full_name, department: l.employee.department, avatar_initials: l.employee.avatar_initials } : null,
    reviewer: l.reviewer ? { name: l.reviewer.full_name } : null,
  }));
  res.json({ success: true, requests: shaped });
});

exports.apply = asyncHandler(async (req, res) => {
  const { leave_type_id, start_date, end_date, reason } = req.body;
  const { id: employee_id, company_id } = req.user;
  const total_days = calcDays(start_date, end_date);
  const year       = new Date(start_date).getFullYear();

  const { data: bal } = await supabase.from("leave_balances")
    .select("*").eq("employee_id", employee_id).eq("leave_type_id", leave_type_id).eq("year", year).single();

  if (bal) {
    const available = bal.total_days - (bal.used_days||0) - (bal.pending_days||0);
    if (available < total_days)
      return res.status(400).json({ success: false, error: `Insufficient balance. Available: ${available} days` });
    await supabase.from("leave_balances").update({ pending_days: (bal.pending_days||0) + total_days }).eq("id", bal.id);
  }

  const { data, error } = await supabase.from("leave_requests").insert({
    employee_id, company_id, leave_type_id, start_date, end_date, total_days, reason, status: "pending",
  }).select("*, leave_type:leave_types(name)").single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.status(201).json({ success: true, message: "Leave request submitted",
    request: { ...data, employee: { name: req.user.name, avatar_initials: req.user.avatar, department: req.user.dept } } });
});

exports.review = asyncHandler(async (req, res) => {
  const { id }                = req.params;
  const { status, review_note } = req.body;

  const { data: leave } = await supabase.from("leave_requests").select("*").eq("id", id).single();
  if (!leave)                   return res.status(404).json({ success: false, error: "Leave request not found" });
  if (leave.status !== "pending") return res.status(400).json({ success: false, error: "Already reviewed" });

  await supabase.from("leave_requests").update({
    status, review_note: review_note||"", reviewed_by: req.user.id, reviewed_at: new Date().toISOString(),
  }).eq("id", id);

  const year = new Date(leave.start_date).getFullYear();
  const { data: bal } = await supabase.from("leave_balances")
    .select("*").eq("employee_id", leave.employee_id).eq("leave_type_id", leave.leave_type_id).eq("year", year).single();
  if (bal) {
    const newPending = Math.max(0, (bal.pending_days||0) - leave.total_days);
    const newUsed    = status === "approved" ? (bal.used_days||0) + leave.total_days : bal.used_days||0;
    await supabase.from("leave_balances").update({ pending_days: newPending, used_days: newUsed }).eq("id", bal.id);
  }

  if (status === "approved") {
    const days = calcDays(leave.start_date, leave.end_date);
    const recs = Array.from({ length: days }, (_, i) => {
      const d = new Date(leave.start_date); d.setDate(d.getDate() + i);
      return { employee_id: leave.employee_id, company_id: leave.company_id, date: d.toISOString().split("T")[0], status: "on-leave" };
    });
    await supabase.from("attendance").upsert(recs, { onConflict: "employee_id,date" });
  }

  res.json({ success: true, message: status === "approved" ? "Leave approved" : "Leave rejected" });
});

exports.cancel = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { data: leave } = await supabase.from("leave_requests").select("*")
    .eq("id", id).eq("employee_id", req.user.id).single();
  if (!leave || leave.status !== "pending")
    return res.status(400).json({ success: false, error: "Cannot cancel this request" });

  await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", id);
  const year = new Date(leave.start_date).getFullYear();
  const { data: bal } = await supabase.from("leave_balances")
    .select("*").eq("employee_id", req.user.id).eq("leave_type_id", leave.leave_type_id).eq("year", year).single();
  if (bal) await supabase.from("leave_balances").update({ pending_days: Math.max(0,(bal.pending_days||0)-leave.total_days) }).eq("id", bal.id);

  res.json({ success: true, message: "Leave cancelled" });
});
