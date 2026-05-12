exports.computePayroll = (profile, attRecords, month, year) => {
  const SLABS    = { admin: 200000, manager: 120000, hr: 90000, employee: 75000 };
  const baseSalary = SLABS[profile.role] || 75000;

  const daysInMonth = new Date(year, month, 0).getDate();
  const workingDays = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month - 1, i + 1))
    .filter(d => d.getDay() !== 0 && d.getDay() !== 6).length;

  const present    = attRecords.filter(r => ["present", "late"].includes(r.status)).length;
  const onLeave    = attRecords.filter(r => r.status === "on-leave").length;
  const late       = attRecords.filter(r => r.status === "late").length;
  const absent     = Math.max(0, workingDays - present - onLeave);
  const totalHours = +(attRecords.reduce((s, r) => s + (r.work_minutes || 0), 0) / 60).toFixed(1);

  const perDay = Math.round(baseSalary / 22);
  const hra    = Math.round(baseSalary * 0.40);
  const ta     = Math.round(baseSalary * 0.10);
  const gross  = baseSalary + hra + ta;

  const absentDeduction = absent * perDay;
  const lateDeduction   = late   * Math.round(perDay / 2);
  const pf              = Math.round(baseSalary * 0.12);
  const tax             = Math.round(baseSalary * 0.10);
  const totalDeductions = absentDeduction + lateDeduction + pf + tax;
  const netPay          = Math.max(0, gross - totalDeductions);

  return {
    basic_salary:     baseSalary,
    hra, ta, gross,
    pf_deduction:     pf,
    tax_deduction:    tax,
    absent_deduction: absentDeduction,
    late_deduction:   lateDeduction,
    total_deductions: totalDeductions,
    net_pay:          netPay,
    days_present:     present,
    days_absent:      absent,
    days_late:        late,
    working_days:     workingDays,
    total_hours:      totalHours,
  };
};
