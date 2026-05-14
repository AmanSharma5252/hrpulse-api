const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

exports.list = asyncHandler(async (req, res) => {
  const { role, company_id } = req.user;
  const isSuperAdmin = role === "super_admin";

  let q = supabase
    .from("companies")
    .select("*")
    .order("created_at", { ascending: false });

  if (!isSuperAdmin) q = q.eq("id", company_id);

  const { data, error } = await q;
  if (error) return res.status(500).json({ success: false, error: error.message });

  // Enrich each company with employee count and admin name
  const enriched = await Promise.all(
    (data || []).map(async co => {
      const { count } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("company_id", co.id)
        .eq("is_active", true);

      const { data: admins } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("company_id", co.id)
        .in("role", ["admin", "super_admin"])
        .limit(1);

      return {
        id:             co.id,
        name:           co.name,
        industry:       co.industry,
        size:           co.size,
        timezone:       co.timezone,
        created_at:     co.created_at,
        plan:           co.plan,
        is_active:      co.is_active,
        employee_count: count || 0,
        admin_name:     admins?.[0]?.full_name || "—",
      };
    })
  );

  res.json({ success: true, companies: enriched });
});

exports.updatePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plan } = req.body;

  const VALID_PLANS = ["starter", "growth", "enterprise"];
  if (!VALID_PLANS.includes(plan))
    return res.status(400).json({ success: false, error: "Invalid plan" });

  // ✅ FIX 1: Update companies table (source of truth for super admin)
  const { error: coErr } = await supabase
    .from("companies")
    .update({ plan })
    .eq("id", id);

  if (coErr)
    return res.status(500).json({ success: false, error: coErr.message });

  // ✅ FIX 2: Also update company_subscriptions if a row exists there,
  //           so both tables stay in sync (login reads from subscriptions first)
  const { data: planRow } = await supabase
    .from("plans")
    .select("id")
    .eq("name", plan)
    .single();

  if (planRow) {
    // Check if a subscription row already exists for this company
    const { data: existingSub } = await supabase
      .from("company_subscriptions")
      .select("id")
      .eq("company_id", id)
      .single();

    if (existingSub) {
      // Update existing subscription
      await supabase
        .from("company_subscriptions")
        .update({ plan_id: planRow.id, status: "active" })
        .eq("company_id", id);
    } else {
      // Insert new subscription row
      await supabase
        .from("company_subscriptions")
        .insert({ company_id: id, plan_id: planRow.id, status: "active" });
    }
  }

  res.json({ success: true, message: "Plan updated to " + plan });
});

exports.updateStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;

  // ✅ FIX: Update companies.is_active — protect middleware now reads this on every request
  const { error } = await supabase
    .from("companies")
    .update({ is_active: active })
    .eq("id", id);

  if (error)
    return res.status(500).json({ success: false, error: error.message });

  res.json({
    success: true,
    message: active ? "Company activated" : "Company suspended",
  });
});
