const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

exports.list = asyncHandler(async (req, res) => {
  const { role, company_id } = req.user;
  const isSuperAdmin = role === "super_admin";

  // Super admin gets all companies; others get only their own
  let q = supabase.from("companies").select("*").order("created_at", { ascending: false });
  if (!isSuperAdmin) q = q.eq("id", company_id);

  const { data, error } = await q;
  if (error) return res.status(500).json({ success: false, error: error.message });

  // For each company, get employee count and admin name
  const enriched = await Promise.all((data||[]).map(async co => {
    const { count } = await supabase.from("profiles").select("*", { count:"exact", head:true }).eq("company_id", co.id).eq("is_active", true);
    const { data: admins } = await supabase.from("profiles").select("full_name").eq("company_id", co.id).in("role", ["admin","super_admin"]).limit(1);
    return {
      id:            co.id,
      name:          co.name,
      industry:      co.industry,
      size:          co.size,
      timezone:      co.timezone,
      created_at:    co.created_at,
      employee_count: count || 0,
      admin_name:    admins?.[0]?.full_name || "—",
    };
  }));

  res.json({ success: true, companies: enriched });
});

exports.updatePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plan } = req.body;
  const VALID_PLANS = ["starter","growth","enterprise"];
  if (!VALID_PLANS.includes(plan)) return res.status(400).json({ success: false, error: "Invalid plan" });

  const { error } = await supabase.from("companies").update({ plan }).eq("id", id);
  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, message: "Plan updated to " + plan });
});

exports.updateStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;

  const { error } = await supabase.from("companies").update({ is_active: active }).eq("id", id);
  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, message: active ? "Company activated" : "Company suspended" });
});
