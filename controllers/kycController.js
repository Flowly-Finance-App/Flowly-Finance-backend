import KYC from "../models/KYC.js";
import User from "../models/User.js";
import Document from "../models/Document.js";
import { createBankAccountForUser } from "./authController.js";



export const submitKYC = async (req, res) => {
  try {
    const { dob, gender, address, idType, idNumber, documentUrl } = req.body;

    if (!address || !idType || !idNumber) {
      return res.status(400).json({
        message: "Please provide address, idType, and idNumber",
      });
    }

    
    let documentRecord = null;
    if (documentUrl) {
      documentRecord = await Document.create({
        user: req.user._id,
        documentType: idType === "pan" ? "pan" : "aadhaar",
        fileUrl: documentUrl,
        verificationStatus: "pending",
      });
    }

    // Check if user already submitted KYC
    let kycRecord = await KYC.findOne({ user: req.user._id });

    if (kycRecord) {
      kycRecord.dob = dob || kycRecord.dob;
      kycRecord.gender = gender || kycRecord.gender;
      kycRecord.address = address || kycRecord.address;
      kycRecord.idType = idType || kycRecord.idType;
      kycRecord.idNumber = idNumber || kycRecord.idNumber;
      if (documentUrl) kycRecord.documentUrl = documentUrl;
      if (documentRecord) kycRecord.document = documentRecord._id;
      kycRecord.verificationStatus = "under_verification";
      kycRecord.rejectionReason = "";
      await kycRecord.save();
    } else {
      kycRecord = await KYC.create({
        user: req.user._id,
        document: documentRecord ? documentRecord._id : undefined,
        dob,
        gender,
        address,
        idType,
        idNumber,
        documentUrl: documentUrl || "",
        verificationStatus: "under_verification",
      });
    }

    // Update user status
    await User.findByIdAndUpdate(req.user._id, {
      kycStatus: "under_verification",
      address,
    });

    return res.status(200).json({
      message: "KYC submitted successfully and is now under verification",
      kyc: kycRecord,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to submit KYC",
      error: error.message,
    });
  }
};


export const getKYCStatus = async (req, res) => {
  try {
    const kyc = await KYC.findOne({ user: req.user._id }).populate("document");

    return res.status(200).json({
      kycStatus: req.user.kycStatus,
      kycDetails: kyc || null,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch KYC status",
      error: error.message,
    });
  }
};


export const getPendingKYCs = async (req, res) => {
  try {
    const pendingKYCs = await KYC.find({
      verificationStatus: { $in: ["pending", "under_verification"] },
    }).populate("user", "name email phone kycStatus createdAt").populate("document");

    return res.status(200).json({
      count: pendingKYCs.length,
      kycs: pendingKYCs,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch pending KYCs",
      error: error.message,
    });
  }
};


export const reviewKYC = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body; // status: "verified" | "rejected"

    if (!["verified", "rejected"].includes(status)) {
      return res.status(400).json({
        message: "Invalid status. Must be 'verified' or 'rejected'.",
      });
    }

    if (status === "rejected" && !rejectionReason) {
      return res.status(400).json({
        message: "Please provide a rejection reason when rejecting KYC.",
      });
    }

    const kyc = await KYC.findById(id);

    if (!kyc) {
      return res.status(404).json({
        message: "KYC record not found",
      });
    }

    kyc.verificationStatus = status;
    kyc.verifiedBy = req.user._id;
    kyc.verifiedAt = new Date();
    if (status === "rejected") {
      kyc.rejectionReason = rejectionReason;
    }
    await kyc.save();

    // Update user kycStatus
    await User.findByIdAndUpdate(kyc.user, {
      kycStatus: status,
    });

    if (kyc.document) {
      await Document.findByIdAndUpdate(kyc.document, {
        verificationStatus: status,
      });
    }

    let account = null;
    if (status === "verified") {
      account = await createBankAccountForUser(kyc.user);
    }

    return res.status(200).json({
      message: `KYC has been ${status} successfully.${status === "verified" ? " Bank account generated and activated." : ""}`,
      kyc,
      account: account
        ? {
            id: account._id,
            accountNumber: account.accountNumber,
            accountType: account.accountType,
            balance: account.balance,
            branch: account.branch,
            ifscCode: account.ifscCode,
            status: account.status,
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to review KYC",
      error: error.message,
    });
  }
};
