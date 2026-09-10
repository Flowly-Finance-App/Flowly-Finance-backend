
export const calculateLoanEMI = (req, res) => {
  try {
    const { amount, interestRate = 12, tenureMonths, tenureYears } = req.body;

    const principal = Number(amount);
    const rateAnnual = Number(interestRate);
    const months = tenureMonths
      ? Number(tenureMonths)
      : tenureYears
      ? Number(tenureYears) * 12
      : 12;

    if (!principal || principal <= 0 || months <= 0) {
      return res.status(400).json({
        message: "Please provide valid loan amount and tenure",
      });
    }

    const r = rateAnnual / (12 * 100);

    let monthlyEMI;
    if (r === 0) {
      monthlyEMI = principal / months;
    } else {
      monthlyEMI =
        (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
    }

    const totalPayable = monthlyEMI * months;
    const totalInterest = totalPayable - principal;

    return res.status(200).json({
      calculation: {
        principalAmount: Math.round(principal * 100) / 100,
        annualInterestRate: rateAnnual,
        tenureMonths: months,
        monthlyEMI: Math.round(monthlyEMI * 100) / 100,
        totalInterest: Math.round(totalInterest * 100) / 100,
        totalPayable: Math.round(totalPayable * 100) / 100,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Loan calculation failed",
      error: error.message,
    });
  }
};


export const calculateFD = (req, res) => {
  try {
    const { principalAmount, interestRate = 7.5, tenureMonths } = req.body;

    const P = Number(principalAmount);
    const r = Number(interestRate);
    const n = Number(tenureMonths);

    if (!P || P <= 0 || !n || n <= 0) {
      return res.status(400).json({
        message: "Please provide valid principal amount and tenure in months",
      });
    }

    // Quarterly Compounding: A = P * (1 + r/400)^(4 * t_years)
    const tYears = n / 12;
    const maturityAmount = P * Math.pow(1 + r / 400, 4 * tYears);
    const totalInterestEarned = maturityAmount - P;

    return res.status(200).json({
      calculation: {
        principalAmount: Math.round(P * 100) / 100,
        annualInterestRate: r,
        tenureMonths: n,
        totalInterestEarned: Math.round(totalInterestEarned * 100) / 100,
        maturityAmount: Math.round(maturityAmount * 100) / 100,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "FD calculation failed",
      error: error.message,
    });
  }
};
