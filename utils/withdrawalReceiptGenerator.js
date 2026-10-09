import PDFDocument from "pdfkit";

/**
 * Renders a standard A4 PDF receipt for a Cash Withdrawal transaction.
 *
 * @param {Object} receipt - Cash withdrawal receipt object (from buildReceipt)
 * @param {Object} [options] - Optional additional customer/worker details
 * @returns {Promise<Buffer>} PDF file buffer
 */
export const generateWithdrawalReceiptPDF = (receipt, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const formatINR = (n) =>
        `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      const formatDate = (d) => {
        if (!d) return "-";
        return new Date(d).toLocaleString("en-IN", {
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        });
      };

      const primaryColor = "#5B2E91"; // Purple accent
      const debitColor = "#B23A2E";   // Red for withdrawal
      const darkText = "#222222";
      const grayText = "#555555";
      const lightBorder = "#E0E0E0";

      // Outer Decorative Border
      doc
        .rect(25, 25, doc.page.width - 50, doc.page.height - 50)
        .lineWidth(1.5)
        .strokeColor(primaryColor)
        .stroke();

      // Header Banner
      doc
        .fillColor(primaryColor)
        .fontSize(22)
        .font("Helvetica-Bold")
        .text("FLOWLY FINANCE", 0, 50, { align: "center" });

      doc
        .fillColor("#666666")
        .fontSize(10)
        .font("Helvetica")
        .text("Branch Banking Operations • Counter Disbursal Desk", { align: "center" });

      doc.moveDown(0.5);

      doc
        .fillColor(darkText)
        .fontSize(15)
        .font("Helvetica-Bold")
        .text("OFFICIAL CASH WITHDRAWAL RECEIPT", { align: "center" });

      doc.moveDown(0.8);

      // Separator Line
      doc
        .moveTo(60, doc.y)
        .lineTo(doc.page.width - 60, doc.y)
        .strokeColor(lightBorder)
        .lineWidth(1)
        .stroke();

      doc.moveDown(1);

      // Disbursal Summary Box
      const boxY = doc.y;
      const boxWidth = doc.page.width - 120;
      doc
        .roundedRect(60, boxY, boxWidth, 65, 8)
        .fillAndStroke("#FFF5F5", "#F2C7C7");

      doc
        .fillColor(grayText)
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("TOTAL CASH DISBURSED", 60, boxY + 12, { width: boxWidth, align: "center" });

      doc
        .fillColor(debitColor)
        .fontSize(22)
        .font("Helvetica-Bold")
        .text(`- ${formatINR(receipt.amount)}`, 60, boxY + 28, { width: boxWidth, align: "center" });

      doc
        .fillColor("#2E7A22")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(`STATUS: ${(receipt.status || "COMPLETED").toUpperCase()} [VERIFIED \u2713]`, 60, boxY + 50, {
          width: boxWidth,
          align: "center",
        });

      doc.y = boxY + 80;

      // Table / Rows Helper
      const row = (label, value, isBoldValue = false, valueColor = darkText) => {
        const y = doc.y;
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor(grayText)
          .text(label, 70, y, { width: 190 });

        doc
          .font(isBoldValue ? "Helvetica-Bold" : "Helvetica")
          .fontSize(10)
          .fillColor(valueColor)
          .text(String(value ?? "-"), 270, y, { width: 250 });

        doc.moveDown(0.75);
      };

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(primaryColor)
        .text("Transaction & Account Details", 70, doc.y);

      doc.moveDown(0.5);

      row("Receipt Number", receipt.receiptNumber, true, primaryColor);
      row("Transaction ID", receipt.transactionId || receipt.id || "-");
      row("Customer Name", receipt.customerName || options.customerName || "-");
      if (options.customerEmail || receipt.customerEmail) {
        row("Customer Email", options.customerEmail || receipt.customerEmail);
      }
      row("Account Number", receipt.accountNumber || receipt.account?.accountNumber || "-");
      row(
        "Account Type",
        (receipt.account?.accountType || "Savings").toUpperCase()
      );
      row("Payment Method", "CASH (Branch Counter Disbursal)");
      row("Branch Location", receipt.branch || "Kochi Main Branch");

      doc.moveDown(0.5);
      doc
        .moveTo(70, doc.y)
        .lineTo(doc.page.width - 70, doc.y)
        .strokeColor(lightBorder)
        .stroke();
      doc.moveDown(0.75);

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(primaryColor)
        .text("Balance & Financial Audit", 70, doc.y);

      doc.moveDown(0.5);

      row("Previous Account Balance", formatINR(receipt.previousBalance));
      row("Amount Disbursed (-)", formatINR(receipt.amount), true, debitColor);
      row("Updated Account Balance", formatINR(receipt.updatedBalance), true, primaryColor);
      if (receipt.remarks) {
        row("Remarks / Disburse Note", receipt.remarks);
      }

      doc.moveDown(0.5);
      doc
        .moveTo(70, doc.y)
        .lineTo(doc.page.width - 70, doc.y)
        .strokeColor(lightBorder)
        .stroke();
      doc.moveDown(0.75);

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(primaryColor)
        .text("Audit & Verification Metadata", 70, doc.y);

      doc.moveDown(0.5);

      const processedByName =
        typeof receipt.processedBy === "object"
          ? receipt.processedBy?.name
          : receipt.processedBy || "Counter Officer";

      row("Processed By (Staff)", processedByName);
      row("Date & Timestamp", formatDate(receipt.timestamp || receipt.completedAt || receipt.initiatedAt));

      doc.moveDown(1);

      // Security Notice & Footer
      doc
        .moveTo(60, doc.y)
        .lineTo(doc.page.width - 60, doc.y)
        .strokeColor(primaryColor)
        .lineWidth(1)
        .stroke();

      doc.moveDown(1);

      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#777777")
        .text(
          "This is a system-generated cash withdrawal receipt issued by Flowly Finance. " +
            "Please verify the physical cash handed over at the counter before leaving the branch. " +
            "For queries, contact support@flowlyfinance.com or call 1800-FLOWLY.",
          70,
          doc.y,
          { width: doc.page.width - 140, align: "left" }
        );

      doc.moveDown(0.8);

      doc
        .fontSize(8)
        .fillColor("#999999")
        .text(`Issued on: ${formatDate(new Date())} \u2022 Generated by Flowly Core Banking System`, 70, doc.y);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

export default generateWithdrawalReceiptPDF;
