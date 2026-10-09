import fs from "fs";
import path from "path";
import { generateWithdrawalReceiptPDF } from "../utils/withdrawalReceiptGenerator.js";

async function testPDF() {
  const dummyReceipt = {
    receiptNumber: "FLWWD-20261004-TEST99",
    transactionId: "651f8a9b1c2d3e4f5a6b7c8d",
    transactionType: "WITHDRAWAL",
    status: "completed",
    amount: 7500,
    currency: "inr",
    paymentMethod: "CASH",
    description: "Branch counter cash withdrawal test",
    account: {
      id: "651f8a9b1c2d3e4f5a6b7c8a",
      accountNumber: "1002938475",
      maskedAccountNumber: "XXXX8475",
      accountType: "savings",
      branch: "Kochi Main Branch",
    },
    accountNumber: "1002938475",
    customerName: "Alex Morgan",
    customerEmail: "alex.morgan@example.com",
    branch: "Kochi Main Branch",
    previousBalance: 50000,
    updatedBalance: 42500,
    remarks: "Counter cash withdrawal for personal expense",
    processedBy: { id: "651f8a9b1c2d3e4f5a6b7c8b", name: "Sarah Connor (Teller Desk 2)" },
    timestamp: new Date().toISOString(),
    initiatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  console.log("Generating Withdrawal Receipt PDF...");
  const buffer = await generateWithdrawalReceiptPDF(dummyReceipt);
  console.log(`Successfully generated PDF! Buffer size: ${buffer.length} bytes`);

  const outputPath = path.join(process.cwd(), "scratch", "sample_withdrawal_receipt.pdf");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  console.log(`Saved sample PDF to: ${outputPath}`);
}

testPDF().catch((err) => {
  console.error("PDF test failed:", err);
  process.exit(1);
});
