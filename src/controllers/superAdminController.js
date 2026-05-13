const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

// Middleware: check caller is a super admin
const isSuperAdmin = asyncHandler(async (req, res, next) => {
  const { data } = await supabase
    .from("super_admins")
    .select("id")
    .eq("id", req.user.id)
    .single();
  if (!data) return res.status(403).json({ success: false, error: "Super admin access required" });
  next();
});

// GET /super/companies — list all companies with their plan
exports.listCompanies = [isSuperAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from("companies")
    .select(`
      id, name, industry, size, created_at,
      company_subscriptions (
        id, status, trial_ends, billing_end,
        plans ( id, name, display_name, price_monthly, features )
      )
    `)
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ success: false, error: error.message });

  // Attach employee count per company
  const enriched = await Promise.all((data || []).map(async co => {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("company_id", co.id)
      .eq("is_active", true);
    return { ...co, employee_count: count || 0 };
  }));

  res.json({ success: true, companies: enriched });
})];

// GET /super/plans — list all plans
exports.listPlans = [isSuperAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .order("price_monthly", { ascending: true, nullsFirst: false });
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, plans: data });
})];

// PATCH /super/companies/:id/plan — change a company's plan
exports.updateCompanyPlan = [isSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plan_id, status, notes, billing_end } = req.body;

  // Upsert subscription
  const { data, error } = await supabase
    .from("company_subscriptions")
    .upsert({
      company_id: id,
      plan_id,
      status: status || "active",
      notes: notes || null,
      billing_end: billing_end || null,
      billing_start: new Date().toISOString(),
      updated_by: req.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id" })
    .select()
    .single();

  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, subscription: data });
})];

// PATCH /super/companies/:id/status — suspend/activate a company
exports.updateCompanyStatus = [isSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'active','suspended','cancelled'

  const { error } = await supabase
    .from("company_subscriptions")
    .update({ status, updated_at: new Date().toISOString(), updated_by: req.user.id })
    .eq("company_id", id);

  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, message: `Company ${status}` });
})];

// GET /super/me/grant — make yourself super admin (one-time setup)
exports.grantSelf = asyncHandler(async (req, res) => {
  const SECRET = process.env.SUPER_ADMIN_SECRET;
  if (!SECRET || req.query.secret !== SECRET)
    return res.status(403).json({ success: false, error: "Invalid secret" });

  await supabase.from("super_admins").upsert({ id: req.user.id }, { onConflict: "id" });
  res.json({ success: true, message: "You are now a super admin" });
});
