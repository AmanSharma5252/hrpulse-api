const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");
const { computePayroll } = require("../utils/payroll");

const todayStr = () => new Date().toISOString().split("T")[0];
const daysAgo  = n  => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().split("T")[0]; };

// ── Dashboard: Admin ──────────────────────────────────────────────────────────
exports.adminDashboard = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const today = todayStr();

  const [
    { count: totalEmployees },
    { data: todayAtt },
    { count: pendingLeaves },
    { data: deptProfiles },
  ] = await Promise.all([
    supabase.from("profiles").select("*",{count:"exact",head:true}).eq("company_id",company_id).eq("is_active",true),
    supabase.from("attendance").select("status").eq("company_id",company_id).eq("date",today),
    supabase.from("leave_requests").select("*",{count:"exact",head:true}).eq("company_id",company_id).eq("status","pending"),
    supabase.from("profiles").select("department").eq("company_id",company_id).eq("is_active",true),
  ]);

  const present = (todayAtt||[]).filter(r=>r.status==="present").length;
  const late    = (todayAtt||[]).filter(r=>r.status==="late").length;
  const onLeave = (todayAtt||[]).filter(r=>r.status==="on-leave").length;
  const absent  = Math.max(0,(totalEmployees||0)-present-late-onLeave);
  const rate    = totalEmployees ? Math.round((present+late)/totalEmployees*100) : 0;

  const dd = {};
  (deptProfiles||[]).forEach(p => { if (p.department) dd[p.department] = (dd[p.department]||0)+1; });

  res.json({ success: true, summary: {
    total_employees: totalEmployees||0, pending_leaves: pendingLeaves||0,
    today_attendance: { present, late, absent, on_leave: onLeave, total: totalEmployees||0, rate },
  }, department_distribution: dd });
});

// ── Dashboard: Me ─────────────────────────────────────────────────────────────
exports.meDashboard = asyncHandler(async (req, res) => {
  const now   = new Date();
  const month = now.getMonth()+1;
  const year  = now.getFullYear();
  const from  = `${year}-${String(month).padStart(2,"0")}-01`;
  const to    = `${year}-${String(month).padStart(2,"0")}-31`;

  const { data: myAtt } = await supabase.from("attendance").select("status,work_minutes")
    .eq("employee_id",req.user.id).gte("date",from).lte("date",to);
  const { data: bals } = await supabase.from("leave_balances")
    .select("total_days,used_days,pending_days,leave_type:leave_types(name)")
    .eq("employee_id",req.user.id).eq("year",year);

  res.json({ success: true, summary: {
    present:       (myAtt||[]).filter(r=>r.status==="present").length,
    late:          (myAtt||[]).filter(r=>r.status==="late").length,
    on_leave:      (myAtt||[]).filter(r=>r.status==="on-leave").length,
    total_minutes: (myAtt||[]).reduce((s,r)=>s+(r.work_minutes||0),0),
  }, balances: bals||[] });
});

// ── Dashboard: Trend ──────────────────────────────────────────────────────────
exports.trend = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const days = parseInt(req.query.days||30);
  const from = daysAgo(days);

  const { data } = await supabase.from("attendance").select("date,status,work_minutes")
    .eq("company_id",company_id).gte("date",from).lte("date",todayStr()).order("date");

  const byDay = {};
  (data||[]).forEach(r => {
    if (!byDay[r.date]) byDay[r.date] = { date:r.date, present:0, late:0, absent:0, on_leave:0, total_minutes:0 };
    if (r.status==="present")   byDay[r.date].present++;
    else if(r.status==="late")  byDay[r.date].late++;
    else if(r.status==="on-leave") byDay[r.date].on_leave++;
    byDay[r.date].total_minutes += (r.work_minutes||0);
  });

  res.json({ success: true, trend: Object.values(byDay).sort((a,b)=>a.date.localeCompare(b.date)) });
});

// ── Analytics: Overview ───────────────────────────────────────────────────────
exports.overview = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const today  = todayStr();
  const from30 = daysAgo(30);

  const [
    { count: totalEmployees },
    { data: todayAtt },
    { count: pendingLeaves },
    { data: deptProfiles },
    { data: trend30 },
  ] = await Promise.all([
    supabase.from("profiles").select("*",{count:"exact",head:true}).eq("company_id",company_id).eq("is_active",true),
    supabase.from("attendance").select("status").eq("company_id",company_id).eq("date",today),
    supabase.from("leave_requests").select("*",{count:"exact",head:true}).eq("company_id",company_id).eq("status","pending"),
    supabase.from("profiles").select("department,role").eq("company_id",company_id).eq("is_active",true),
    supabase.from("attendance").select("date,status,work_minutes").eq("company_id",company_id).gte("date",from30).order("date"),
  ]);

  const present = (todayAtt||[]).filter(r=>r.status==="present").length;
  const late    = (todayAtt||[]).filter(r=>r.status==="late").length;
  const rate    = totalEmployees ? Math.round((present+late)/totalEmployees*100) : 0;

  const dd={}, rd={};
  (deptProfiles||[]).forEach(p=>{
    if(p.department) dd[p.department]=(dd[p.department]||0)+1;
    if(p.role)       rd[p.role]=(rd[p.role]||0)+1;
  });

  const byDay={};
  (trend30||[]).forEach(r=>{
    if(!byDay[r.date]) byDay[r.date]={date:r.date,present:0,late:0,total_minutes:0};
    if(r.status==="present")byDay[r.date].present++;
    else if(r.status==="late")byDay[r.date].late++;
    byDay[r.date].total_minutes+=(r.work_minutes||0);
  });
  const trendArr = Object.values(byDay)
    .map(d=>({...d, avg_hours: totalEmployees?+(d.total_minutes/60/totalEmployees).toFixed(1):0,
      attendance_rate: totalEmployees?Math.round((d.present+d.late)/totalEmployees*100):0 }))
    .sort((a,b)=>a.date.localeCompare(b.date));

  res.json({ success: true,
    total_employees: totalEmployees||0,
    today: { present, late, absent: Math.max(0,(totalEmployees||0)-present-late), rate },
    pending_leaves: pendingLeaves||0,
    department_distribution: dd, role_distribution: rd,
    trend_30_days: trendArr, avg_hours_trend: trendArr,
  });
});

// ── Payroll: All employees ────────────────────────────────────────────────────
exports.getPayroll = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const now      = new Date();
  const month    = parseInt(req.query.month || now.getMonth()+1);
  const year     = parseInt(req.query.year  || now.getFullYear());
  const monthStr = `${year}-${String(month).padStart(2,"0")}`;

  const { data: profiles } = await supabase.from("profiles")
    .select("id,full_name,role,department,title,avatar_initials,employee_code")
    .eq("company_id",company_id).eq("is_active",true);

  const { data: attRecs } = await supabase.from("attendance")
    .select("employee_id,status,work_minutes,date")
    .eq("company_id",company_id)
    .gte("date",`${monthStr}-01`).lte("date",`${monthStr}-31`);

  const payrolls = (profiles||[]).map(p => {
    const pRecs = (attRecs||[]).filter(r=>r.employee_id===p.id);
    const calc  = computePayroll({ ...p, role: p.role||"employee" }, pRecs, month, year);
    return { employee_id:p.id, employee:{ name:p.full_name, code:p.employee_code, dept:p.department, title:p.title, avatar:p.avatar_initials }, ...calc, month, year };
  });

  const totals = payrolls.reduce((s,p)=>({ gross:s.gross+p.gross, net:s.net+p.net_pay, deductions:s.deductions+p.total_deductions }),{gross:0,net:0,deductions:0});
  res.json({ success: true, month, year, payrolls, totals, employee_count: payrolls.length });
});

// ── Payroll: My payslip ───────────────────────────────────────────────────────
exports.getMyPayslip = asyncHandler(async (req, res) => {
  const now      = new Date();
  const month    = parseInt(req.query.month || now.getMonth()+1);
  const year     = parseInt(req.query.year  || now.getFullYear());
  const monthStr = `${year}-${String(month).padStart(2,"0")}`;

  const { data: profile } = await supabase.from("profiles")
    .select("role,full_name,department,title,avatar_initials,employee_code").eq("id",req.user.id).single();
  const { data: attRecs } = await supabase.from("attendance")
    .select("status,work_minutes,date").eq("employee_id",req.user.id)
    .gte("date",`${monthStr}-01`).lte("date",`${monthStr}-31`);

  const calc = computePayroll({ ...profile, role: profile?.role||"employee" }, attRecs||[], month, year);
  res.json({ success: true, employee: { name: profile?.full_name, ...profile }, ...calc, month, year });
});
