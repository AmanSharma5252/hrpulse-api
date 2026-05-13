const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

// GET /api/v1/payroll/config
exports.getConfig = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const { data: company } = await supabase
    .from("companies")
    .select("pf_pct, tax_pct, esic_pct, name")
    .eq("id", company_id)
    .single();

  res.json({ success: true, config: {
    pf_pct:   company?.pf_pct   ?? 12,
    tax_pct:  company?.tax_pct  ?? 10,
    esic_pct: company?.esic_pct ?? 0,
  }});
});

// PATCH /api/v1/payroll/config
exports.updateConfig = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const { pf_pct, tax_pct, esic_pct } = req.body;

  const { error } = await supabase
    .from("companies")
    .update({ pf_pct, tax_pct, esic_pct })
    .eq("id", company_id);

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: "Payroll config updated" });
});

// GET /api/v1/payroll/employees
exports.getEmployeeSalaries = asyncHandler(async (req, res) => {
  const { company_id } = req.user;

  const { data: employees, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, title, avatar_initials, employee_code, basic_salary, hra_pct, ta_amount, special_allowance, bonus, bank_account, bank_ifsc, bank_name, is_active")
    .eq("company_id", company_id)
    .eq("is_active", true)
    .order("full_name");

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, employees: employees || [] });
});

// PATCH /api/v1/payroll/employees/:id/salary
exports.updateSalary = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { basic_salary, hra_pct, ta_amount, special_allowance, bonus, bank_account, bank_ifsc, bank_name } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (basic_salary      != null) updates.basic_salary      = basic_salary;
  if (hra_pct           != null) updates.hra_pct           = hra_pct;
  if (ta_amount         != null) updates.ta_amount         = ta_amount;
  if (special_allowance != null) updates.special_allowance = special_allowance;
  if (bonus             != null) updates.bonus             = bonus;
  if (bank_account      != null) updates.bank_account      = bank_account;
  if (bank_ifsc         != null) updates.bank_ifsc         = bank_ifsc;
  if (bank_name         != null) updates.bank_name         = bank_name;

 const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  console.log("SALARY UPDATE:", { id, updates, error });
  if (error) return res.status(500).json({ success: false, error: error.message });

// GET /api/v1/payroll/summary?month=5&year=2026
exports.getPayrollSummary = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const now   = new Date();
  const month = parseInt(req.query.month || now.getMonth() + 1);
  const year  = parseInt(req.query.year  || now.getFullYear());

  // Get all active employees with salary
  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, title, avatar_initials, employee_code, basic_salary, hra_pct, ta_amount, special_allowance, bonus, bank_account, bank_ifsc, bank_name")
    .eq("company_id", company_id)
    .eq("is_active", true)
    .order("full_name");

  // Get company deduction config
  const { data: company } = await supabase
    .from("companies")
    .select("pf_pct, tax_pct, esic_pct, name")
    .eq("id", company_id)
    .single();

  const pf_pct   = company?.pf_pct   ?? 12;
  const tax_pct  = company?.tax_pct  ?? 10;
  const esic_pct = company?.esic_pct ?? 0;

  // Get attendance for the month
  const from = `${year}-${String(month).padStart(2,"0")}-01`;
  const to   = `${year}-${String(month).padStart(2,"0")}-31`;

  const { data: attendance } = await supabase
    .from("attendance")
    .select("employee_id, status, work_minutes")
    .eq("company_id", company_id)
    .gte("date", from).lte("date", to);

  // Get existing payroll records
  const { data: payrollRecords } = await supabase
    .from("payroll")
    .select("*")
    .eq("company_id", company_id)
    .eq("month", month)
    .eq("year", year);

  // Working days in month (approx)
  const daysInMonth = new Date(year, month, 0).getDate();
  const workingDays = Math.round(daysInMonth * 5 / 7);

  const payroll = (employees || []).map(emp => {
    const empAtt    = (attendance || []).filter(a => a.employee_id === emp.id);
    const present   = empAtt.filter(a => ["present","late"].includes(a.status)).length;
    const onLeave   = empAtt.filter(a => a.status === "on-leave").length;
    const absent    = Math.max(0, workingDays - present - onLeave);
    const totalMins = empAtt.reduce((s, a) => s + (a.work_minutes || 0), 0);

    const basic    = parseFloat(emp.basic_salary) || 0;
    const hra      = basic * (parseFloat(emp.hra_pct) || 40) / 100;
    const ta       = parseFloat(emp.ta_amount) || 1600;
    const special  = parseFloat(emp.special_allowance) || 0;
    const bonus    = parseFloat(emp.bonus) || 0;
    const gross    = basic + hra + ta + special + bonus;

    // Per-day salary for absent deduction
    const perDay         = basic / workingDays;
    const absentDeduct   = perDay * absent;
    const pfDeduct       = basic * pf_pct / 100;
    const taxDeduct      = gross * tax_pct / 100;
    const esicDeduct     = gross * esic_pct / 100;
    const totalDeduct    = absentDeduct + pfDeduct + taxDeduct + esicDeduct;
    const netPay         = Math.max(0, gross - totalDeduct);

    const existing = (payrollRecords || []).find(p => p.employee_id === emp.id);

    return {
      id:               existing?.id || null,
      employee_id:      emp.id,
      name:             emp.full_name,
      role:             emp.role,
      department:       emp.department,
      title:            emp.title,
      avatar:           emp.avatar_initials,
      employee_code:    emp.employee_code,
      bank_account:     emp.bank_account,
      bank_ifsc:        emp.bank_ifsc,
      bank_name:        emp.bank_name,
      basic_salary:     basic,
      hra, ta, special, bonus, gross,
      pf:               pfDeduct,
      tax:              taxDeduct,
      esic:             esicDeduct,
      absent_deduction: absentDeduct,
      total_deductions: totalDeduct,
      net_pay:          netPay,
      days_present:     present,
      days_absent:      absent,
      days_leave:       onLeave,
      working_days:     workingDays,
      hours_worked:     Math.round(totalMins / 60),
      status:           existing?.status || "draft",
      hra_pct:          emp.hra_pct || 40,
      pf_pct, tax_pct, esic_pct,
    };
  });

  res.json({ success: true, payroll, month, year,
    totals: {
      gross:      payroll.reduce((s,p) => s + p.gross, 0),
      deductions: payroll.reduce((s,p) => s + p.total_deductions, 0),
      net:        payroll.reduce((s,p) => s + p.net_pay, 0),
      count:      payroll.length,
    },
    config: { pf_pct, tax_pct, esic_pct },
  });
});

// POST /api/v1/payroll/mark-paid
exports.markPaid = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const { employee_id, month, year, gross, total_deductions, net_pay, days_present, days_absent, basic_salary } = req.body;

  const { data, error } = await supabase
    .from("payroll")
    .upsert({
      employee_id, company_id, month, year,
      basic_salary, gross, total_deductions, net_pay,
      days_present, days_absent, status: "paid",
    }, { onConflict: "employee_id,month,year" })
    .select()
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: "Marked as paid", record: data });
});

// POST /api/v1/payroll/mark-all-paid
exports.markAllPaid = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const { month, year, employees } = req.body;

  const records = employees.map(e => ({
    employee_id: e.employee_id, company_id, month, year,
    basic_salary: e.basic_salary, gross: e.gross,
    total_deductions: e.total_deductions, net_pay: e.net_pay,
    days_present: e.days_present, days_absent: e.days_absent,
    status: "paid",
  }));

  const { error } = await supabase
    .from("payroll")
    .upsert(records, { onConflict: "employee_id,month,year" });

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: `${records.length} employees marked as paid` });
});

// POST /api/v1/payroll/send-payslip
exports.sendPayslip = asyncHandler(async (req, res) => {
  const { employee_id, month, year } = req.body;
  const { company_id } = req.user;

  // Get employee email
  const { data: authUser } = await supabase.auth.admin.getUserById(employee_id);
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, basic_salary, bank_account, bank_ifsc")
    .eq("id", employee_id)
    .single();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", company_id)
    .single();

  if (!authUser?.user?.email) {
    return res.status(400).json({ success: false, error: "Employee email not found" });
  }

  // For now log — integrate with SendGrid/Resend for actual email
  console.log(`PAYSLIP EMAIL → ${authUser.user.email} for ${profile?.full_name} | ${company?.name} | ${month}/${year}`);

  res.json({
    success: true,
    message: `Payslip sent to ${authUser.user.email}`,
    email: authUser.user.email,
  });
});

// PATCH /api/v1/payroll/bank-details (employee updates own bank details)
exports.updateBankDetails = asyncHandler(async (req, res) => {
  const { bank_account, bank_ifsc, bank_name } = req.body;

  const { error } = await supabase
    .from("profiles")
    .update({ bank_account, bank_ifsc, bank_name, updated_at: new Date().toISOString() })
    .eq("id", req.user.id);

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: "Bank details updated" });
});
