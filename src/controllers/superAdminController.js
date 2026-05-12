const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

const SUPER_ADMIN_EMAIL = "aamansharmaaman@gmail.com";

function requireSuperAdmin(req, res) {
  if (req.user.email !== SUPER_ADMIN_EMAIL) {
    res.status(403).json({ success: false, error: "Super admin access required" });
    return false;
  }
  return true;
}

// GET /api/v1/superadmin/companies
exports.listCompanies = asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const { data: companies, error } = await supabase
    .from("companies")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });

  // For each company, get employee count and today's attendance
  const enriched = await Promise.all((companies || []).map(async (co) => {
    const { count: empCount } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("company_id", co.id)
      .eq("is_active", true);

    const today = new Date().toISOString().split("T")[0];
    const { count: presentToday } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("company_id", co.id)
      .eq("date", today)
      .in("status", ["present", "late"]);

    return {
      id:              co.id,
      name:            co.name,
      industry:        co.industry,
      size:            co.size,
      timezone:        co.timezone,
      plan:            co.plan || "free",
      plan_expires_at: co.plan_expires_at,
      billing_email:   co.billing_email,
      is_suspended:    co.is_suspended || false,
      created_at:      co.created_at,
      employee_count:  empCount || 0,
      present_today:   presentToday || 0,
    };
  }));

  res.json({ success: true, companies: enriched });
});

// GET /api/v1/superadmin/companies/:id
exports.getCompanyDetail = asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const { id } = req.params;

  const { data: company } = await supabase.from("companies").select("*").eq("id", id).single();
  if (!company) return res.status(404).json({ success: false, error: "Company not found" });

  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, title, is_active, hire_date, avatar_initials, employee_code")
    .eq("company_id", id)
    .order("full_name");

  const today = new Date().toISOString().split("T")[0];
  const { data: todayAtt } = await supabase
    .from("attendance")
    .select("employee_id, status, check_in, check_out, work_minutes")
    .eq("company_id", id)
    .eq("date", today);

  const { data: leaveRequests } = await supabase
    .from("leave_requests")
    .select("id, employee_id, status, start_date, end_date, total_days, created_at")
    .eq("company_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  res.json({
    success: true,
    company,
    employees: employees || [],
    today_attendance: todayAtt || [],
    recent_leaves: leaveRequests || [],
  });
});

// PATCH /api/v1/superadmin/companies/:id/suspend
exports.suspendCompany = asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const { id } = req.params;
  const { suspend } = req.body;

  const { error } = await supabase
    .from("companies")
    .update({ is_suspended: suspend })
    .eq("id", id);

  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, message: suspend ? "Company suspended" : "Company activated" });
});

// PATCH /api/v1/superadmin/companies/:id/plan
exports.updatePlan = asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const { id } = req.params;
  const { plan, plan_expires_at, billing_email } = req.body;

  const updates = {};
  if (plan)            updates.plan            = plan;
  if (plan_expires_at) updates.plan_expires_at = plan_expires_at;
  if (billing_email)   updates.billing_email   = billing_email;

  const { error } = await supabase.from("companies").update(updates).eq("id", id);
  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, message: "Plan updated" });
});

// GET /api/v1/superadmin/stats
exports.getStats = asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const { count: totalCompanies } = await supabase
    .from("companies").select("*", { count: "exact", head: true });

  const { count: totalEmployees } = await supabase
    .from("profiles").select("*", { count: "exact", head: true }).eq("is_active", true);

  const { count: suspended } = await supabase
    .from("companies").select("*", { count: "exact", head: true }).eq("is_suspended", true);

  const { data: planCounts } = await supabase
    .from("companies").select("plan");

  const plans = { free: 0, starter: 0, growth: 0, enterprise: 0 };
  (planCounts || []).forEach(c => { if (plans[c.plan] !== undefined) plans[c.plan]++; });

  const today = new Date().toISOString().split("T")[0];
  const { count: todayLogins } = await supabase
    .from("attendance").select("*", { count: "exact", head: true }).eq("date", today);

  res.json({
    success: true,
    stats: {
      total_companies:  totalCompanies  || 0,
      total_employees:  totalEmployees  || 0,
      suspended:        suspended       || 0,
      active_companies: (totalCompanies || 0) - (suspended || 0),
      today_logins:     todayLogins     || 0,
      plans,
      // Simple revenue estimate
      mrr: (plans.starter * 999) + (plans.growth * 2499) + (plans.enterprise * 9999),
    },
  });
});
