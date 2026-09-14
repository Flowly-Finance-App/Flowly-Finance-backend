export function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function calculateEMI(principal, annualRatePercent, tenureMonths) {
  if (principal <= 0 || tenureMonths <= 0) {
    throw new Error("principal and tenureMonths must be positive");
  }
  const r = annualRatePercent / 12 / 100;

  if (r === 0) {
    return round2(principal / tenureMonths);
  }

  const factor = Math.pow(1 + r, tenureMonths);
  const emi = (principal * r * factor) / (factor - 1);
  return round2(emi);
}

export function generateSchedule({ principal, annualRatePercent, tenureMonths, startDate }) {
  const emi = calculateEMI(principal, annualRatePercent, tenureMonths);
  const r = annualRatePercent / 12 / 100;

  let balance = principal;
  let totalInterest = 0;
  const schedule = [];
  let dueDate = new Date(startDate);

  for (let i = 1; i <= tenureMonths; i++) {
    dueDate = addMonths(dueDate, 1);

    const interestComponent = round2(balance * r);
    let principalComponent = round2(emi - interestComponent);
    let installmentAmount = emi;

    if (i === tenureMonths) {
      principalComponent = balance;
      installmentAmount = round2(principalComponent + interestComponent);
    }

    balance = round2(balance - principalComponent);
    totalInterest = round2(totalInterest + interestComponent);

    schedule.push({
      installmentNo: i,
      dueDate,
      emiAmount: installmentAmount,
      principalComponent,
      interestComponent,
      outstandingBalance: Math.max(balance, 0),
      status: "Pending",
      paidAmount: 0,
      paidDate: null,
      gateway: undefined,
    });
  }

  return {
    emi,
    totalInterest,
    totalRepayment: round2(principal + totalInterest),
    schedule,
  };
}
