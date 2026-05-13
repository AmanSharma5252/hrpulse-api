const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");
const { Resend }   = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Payslip HTML Generator ───────────────────────────────────────────────────
function buildPayslipHTML({ employee, company, payslip, month, year }) {
  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
  const monthName  = monthNames[month - 1];
  const uniqueId   = `PS-${employee.employee_code || employee.id.slice(0,6).toUpperCase()}-${year}${String(month).padStart(2,"0")}`;
  const qrUrl      = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(uniqueId)}`;

  const fmt = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

  const deductionRows = [
    payslip.pf         > 0 && `<tr><td>Provident Fund (${payslip.pf_pct}%)</td><td style="color:#EF4444">${fmt(payslip.pf)}</td></tr>`,
    payslip.tax        > 0 && `<tr><td>Income Tax (${payslip.tax_pct}%)</td><td style="color:#EF4444">${fmt(payslip.tax)}</td></tr>`,
    payslip.esic       > 0 && `<tr><td>ESIC (${payslip.esic_pct}%)</td><td style="color:#EF4444">${fmt(payslip.esic)}</td></tr>`,
    payslip.absent_deduction > 0 && `<tr><td>Absent Deduction (${payslip.days_absent} days)</td><td style="color:#EF4444">${fmt(payslip.absent_deduction)}</td></tr>`,
  ].filter(Boolean).join("");

  const earningRows = [
    `<tr><td>Basic Salary</td><td style="color:#16a34a">${fmt(payslip.basic_salary)}</td></tr>`,
    payslip.hra    > 0 && `<tr><td>HRA (${payslip.hra_pct}%)</td><td style="color:#16a34a">${fmt(payslip.hra)}</td></tr>`,
    payslip.ta     > 0 && `<tr><td>Travel Allowance</td><td style="color:#16a34a">${fmt(payslip.ta)}</td></tr>`,
    payslip.special > 0 && `<tr><td>Special Allowance</td><td style="color:#16a34a">${fmt(payslip.special)}</td></tr>`,
    payslip.bonus  > 0 && `<tr><td>Bonus</td><td style="color:#16a34a">${fmt(payslip.bonus)}</td></tr>`,
  ].filter(Boolean).join("");

  const bankSection = (payslip.bank_account) ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px">
      <strong>Bank:</strong> ${payslip.bank_name || "—"} &nbsp;|&nbsp;
      <strong>Account:</strong> ****${payslip.bank_account.slice(-4)} &nbsp;|&nbsp;
      <strong>IFSC:</strong> ${payslip.bank_ifsc || "—"}
    </div>` : "";

  const logoSection = company.logo_url
    ? `<img src="${company.logo_url}" alt="${company.name}" style="height:48px;max-width:160px;object-fit:contain;margin-bottom:4px"/>`
    : `<div style="font-size:22px;font-weight:900;color:#16a34a">${company.name}</div>`;

  const signatureSection = company.signature_url ? `
    <div style="margin-top:30px;padding-top:20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end">
      <div style="text-align:center">
        <img src="${company.signature_url}" alt="Signature" style="height:50px;max-width:160px;object-fit:contain;margin-bottom:4px"/>
        <div style="font-size:11px;color:#6b7280">Authorised Signatory</div>
        <div style="font-size:11px;color:#6b7280">${company.name}</div>
      </div>
    </div>` : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Payslip — ${monthName} ${year}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:620px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:#0f172a;padding:24px 28px;display:flex;justify-content:space-between;align-items:center">
      <div>
        ${logoSection}
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">${company.address || ""}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;color:#fff">PAYSLIP</div>
        <div style="font-size:12px;color:#94a3b8">${monthName} ${year}</div>
        <div style="font-size:10px;color:#64748b;margin-top:4px;font-family:monospace">${uniqueId}</div>
      </div>
    </div>

    <!-- Employee Info -->
    <div style="padding:20px 28px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:16px;font-weight:700;color:#0f172a">${employee.full_name}</div>
        <div style="font-size:12px;color:#64748b">${employee.title || ""} · ${employee.department || ""}</div>
        <div style="font-size:11px;color:#94a3b8;font-family:monospace">${employee.employee_code || ""}</div>
      </div>
      <div style="text-align:right;font-size:12px;color:#64748b">
        <div>Working Days: <strong>${payslip.working_days}</strong></div>
        <div>Present: <strong style="color:#16a34a">${payslip.days_present}</strong></div>
        <div>Absent: <strong style="color:#dc2626">${payslip.days_absent}</strong></div>
        <div>Hours: <strong>${payslip.hours_worked}h</strong></div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:24px 28px">
      ${bankSection}

      <!-- Earnings & Deductions side by side -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead>
          <tr>
            <th style="text-align:left;font-size:11px;color:#64748b;letter-spacing:1px;padding-bottom:8px;width:50%;border-bottom:2px solid #e2e8f0">EARNINGS</th>
            <th style="text-align:right;font-size:11px;color:#64748b;letter-spacing:1px;padding-bottom:8px;width:25%;border-bottom:2px solid #e2e8f0">AMOUNT</th>
            <th style="width:25%"></th>
          </tr>
        </thead>
        <tbody style="font-size:13px">
          ${earningRows}
          <tr style="font-weight:700;border-top:1px solid #e2e8f0">
            <td style="padding-top:8px;color:#0f172a">Gross Salary</td>
            <td style="padding-top:8px;color:#16a34a;text-align:right">${fmt(payslip.gross)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <thead>
          <tr>
            <th style="text-align:left;font-size:11px;color:#64748b;letter-spacing:1px;padding-bottom:8px;width:50%;border-bottom:2px solid #e2e8f0">DEDUCTIONS</th>
            <th style="text-align:right;font-size:11px;color:#64748b;letter-spacing:1px;padding-bottom:8px;width:25%;border-bottom:2px solid #e2e8f0">AMOUNT</th>
            <th style="width:25%"></th>
          </tr>
        </thead>
        <tbody style="font-size:13px">
          ${deductionRows || "<tr><td colspan='3' style='color:#94a3b8;font-size:12px'>No deductions</td></tr>"}
          <tr style="font-weight:700;border-top:1px solid #e2e8f0">
            <td style="padding-top:8px;color:#0f172a">Total Deductions</td>
            <td style="padding-top:8px;color:#dc2626;text-align:right">${fmt(payslip.total_deductions)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <!-- Net Pay -->
      <div style="background:#0f172a;border-radius:10px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div style="color:#94a3b8;font-size:14px;font-weight:600;letter-spacing:1px">NET PAY</div>
        <div style="color:#4ade80;font-size:26px;font-weight:900;font-family:monospace">${fmt(payslip.net_pay)}</div>
      </div>

      <!-- QR Code -->
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-bottom:8px">
        <div style="font-size:10px;color:#94a3b8;text-align:right">
          <div>Scan to verify</div>
          <div style="font-family:monospace">${uniqueId}</div>
        </div>
        <img src="${qrUrl}" alt="QR" style="width:80px;height:80px;border-radius:6px;border:1px solid #e2e8f0"/>
      </div>

      ${signatureSection}
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8">
      This is a computer-generated payslip and does not require a physical signature. &nbsp;·&nbsp; ${company.name}
    </div>
  </div>
</body>
</html>`;
}

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

  const updates = {};
  if (basic_salary      != null) updates.basic_salary      = parseFloat(basic_salary) || 0;
  if (hra_pct           != null) updates.hra_pct           = parseFloat(hra_pct) || 0;
  if (ta_amount         != null) updates.ta_amount         = parseFloat(ta_amount) || 0;
  if (special_allowance != null) updates.special_allowance = parseFloat(special_allowance) || 0;
  if (bonus             != null) updates.bonus             = parseFloat(bonus) || 0;
  if (bank_account      != null) updates.bank_account      = bank_account;
  if (bank_ifsc         != null) updates.bank_ifsc         = bank_ifsc;
  if (bank_name         != null) updates.bank_name         = bank_name;

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id);

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: "Salary updated" });
});

// GET /api/v1/payroll/summary?month=5&year=2026
exports.getPayrollSummary = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const now   = new Date();
  const month = parseInt(req.query.month || now.getMonth() + 1);
  const year  = parseInt(req.query.year  || now.getFullYear());

  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, title, avatar_initials, employee_code, basic_salary, hra_pct, ta_amount, special_allowance, bonus, bank_account, bank_ifsc, bank_name")
    .eq("company_id", company_id)
    .eq("is_active", true)
    .order("full_name");

  const { data: company } = await supabase
    .from("companies")
    .select("pf_pct, tax_pct, esic_pct, name")
    .eq("id", company_id)
    .single();

  const pf_pct   = company?.pf_pct   ?? 12;
  const tax_pct  = company?.tax_pct  ?? 10;
  const esic_pct = company?.esic_pct ?? 0;

  const from = `${year}-${String(month).padStart(2,"0")}-01`;
  const to   = `${year}-${String(month).padStart(2,"0")}-31`;

  const { data: attendance } = await supabase
    .from("attendance")
    .select("employee_id, status, work_minutes")
    .eq("company_id", company_id)
    .gte("date", from).lte("date", to);

  const { data: payrollRecords } = await supabase
    .from("payroll")
    .select("*")
    .eq("company_id", company_id)
    .eq("month", month)
    .eq("year", year);

  const daysInMonth = new Date(year, month, 0).getDate();
  const workingDays = Math.round(daysInMonth * 5 / 7);

  const payroll = (employees || []).map(emp => {
    const empAtt    = (attendance || []).filter(a => a.employee_id === emp.id);
    const present   = empAtt.filter(a => ["present","late"].includes(a.status)).length;
    const onLeave   = empAtt.filter(a => a.status === "on-leave").length;
    const absent    = Math.max(0, workingDays - present - onLeave);
    const totalMins = empAtt.reduce((s, a) => s + (a.work_minutes || 0), 0);

    const basic   = parseFloat(emp.basic_salary) || 0;
    const hra     = basic * (parseFloat(emp.hra_pct) || 0) / 100;
    const ta      = parseFloat(emp.ta_amount) || 0;
    const special = parseFloat(emp.special_allowance) || 0;
    const bonus   = parseFloat(emp.bonus) || 0;
    const gross   = basic + hra + ta + special + bonus;

    const perDay       = workingDays > 0 ? basic / workingDays : 0;
    const absentDeduct = perDay * absent;
    const pfDeduct     = basic * pf_pct / 100;
    const taxDeduct    = gross * tax_pct / 100;
    const esicDeduct   = gross * esic_pct / 100;
    const totalDeduct  = absentDeduct + pfDeduct + taxDeduct + esicDeduct;
    const netPay       = Math.max(0, gross - totalDeduct);

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
      hra_pct:          parseFloat(emp.hra_pct) || 0,
      ta_amount:        parseFloat(emp.ta_amount) || 0,
      special_allowance: parseFloat(emp.special_allowance) || 0,
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

  const { error } = await supabase
    .from("payroll")
    .upsert({
      employee_id, company_id, month, year,
      basic_salary, gross, total_deductions, net_pay,
      days_present, days_absent, status: "paid",
    }, { onConflict: "employee_id,month,year" });

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: "Marked as paid" });
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

  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];

  // Fetch all needed data in parallel
  const [authResult, profileResult, companyResult, summaryResult] = await Promise.all([
    supabase.auth.admin.getUserById(employee_id),
    supabase.from("profiles")
      .select("full_name, title, department, employee_code, basic_salary, hra_pct, ta_amount, special_allowance, bonus, bank_account, bank_ifsc, bank_name")
      .eq("id", employee_id).single(),
    supabase.from("companies")
      .select("name, logo_url, signature_url, address, pf_pct, tax_pct, esic_pct")
      .eq("id", company_id).single(),
    // Get attendance for the month to compute payslip figures
    supabase.from("attendance")
      .select("status, work_minutes")
      .eq("employee_id", employee_id)
      .gte("date", `${year}-${String(month).padStart(2,"0")}-01`)
      .lte("date", `${year}-${String(month).padStart(2,"0")}-31`),
  ]);

  const email   = authResult.data?.user?.email;
  const profile = profileResult.data;
  const company = companyResult.data;
  const att     = summaryResult.data || [];

  if (!email) return res.status(400).json({ success: false, error: "Employee email not found" });
  if (!profile) return res.status(404).json({ success: false, error: "Employee profile not found" });

  // Compute payslip figures
  const daysInMonth = new Date(year, month, 0).getDate();
  const workingDays = Math.round(daysInMonth * 5 / 7);
  const present     = att.filter(a => ["present","late"].includes(a.status)).length;
  const onLeave     = att.filter(a => a.status === "on-leave").length;
  const absent      = Math.max(0, workingDays - present - onLeave);
  const totalMins   = att.reduce((s, a) => s + (a.work_minutes || 0), 0);

  const pf_pct   = company?.pf_pct   ?? 12;
  const tax_pct  = company?.tax_pct  ?? 10;
  const esic_pct = company?.esic_pct ?? 0;

  const basic   = parseFloat(profile.basic_salary) || 0;
  const hra_pct = parseFloat(profile.hra_pct) || 0;
  const hra     = basic * hra_pct / 100;
  const ta      = parseFloat(profile.ta_amount) || 0;
  const special = parseFloat(profile.special_allowance) || 0;
  const bonus   = parseFloat(profile.bonus) || 0;
  const gross   = basic + hra + ta + special + bonus;

  const perDay       = workingDays > 0 ? basic / workingDays : 0;
  const absent_deduction = perDay * absent;
  const pf           = basic * pf_pct / 100;
  const tax          = gross * tax_pct / 100;
  const esic         = gross * esic_pct / 100;
  const total_deductions = absent_deduction + pf + tax + esic;
  const net_pay      = Math.max(0, gross - total_deductions);

  const payslip = {
    basic_salary: basic, hra_pct, hra, ta, special, bonus, gross,
    pf_pct, tax_pct, esic_pct, pf, tax, esic,
    absent_deduction, total_deductions, net_pay,
    days_present: present, days_absent: absent, days_leave: onLeave,
    working_days: workingDays, hours_worked: Math.round(totalMins / 60),
    bank_account: profile.bank_account, bank_ifsc: profile.bank_ifsc, bank_name: profile.bank_name,
  };

  const html = buildPayslipHTML({
    employee: { ...profile, id: employee_id },
    company:  company || { name: "Your Company" },
    payslip,
    month,
    year,
  });

  const { error: emailError } = await resend.emails.send({
    from:    process.env.RESEND_FROM_EMAIL || "payroll@hrpulse.io",
    to:      email,
    subject: `Your Payslip for ${monthNames[month - 1]} ${year} — ${company?.name || ""}`,
    html,
  });

  if (emailError) {
    console.error("Resend error:", emailError);
    return res.status(500).json({ success: false, error: "Failed to send email: " + emailError.message });
  }

  res.json({
    success: true,
    message: `Payslip sent to ${email}`,
    email,
  });
});

// PATCH /api/v1/payroll/bank-details
exports.updateBankDetails = asyncHandler(async (req, res) => {
  const { bank_account, bank_ifsc, bank_name } = req.body;

  const { error } = await supabase
    .from("profiles")
    .update({ bank_account, bank_ifsc, bank_name })
    .eq("id", req.user.id);

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: "Bank details updated" });
});