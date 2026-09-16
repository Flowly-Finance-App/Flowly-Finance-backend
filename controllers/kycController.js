import KYC from "../models/KYC.js";
import User from "../models/User.js";
import Document from "../models/Document.js";
import Account from "../models/Account.js";
import { createBankAccountForUser } from "./authController.js";
import { sendNotification } from "./notificationController.js";

export const submitKYC = async (req, res) => {
  try {
    const { dob, gender, address, idType, idNumber } = req.body;

    if (!address || !idType || !idNumber) {
      return res.status(400).json({
        message: "Please provide address, idType, and idNumber",
      });
    }

    // Prefer an uploaded file (multipart/form-data, field name "document").
    // Fall back to a raw documentUrl string in the body for clients that
    // host the file elsewhere (e.g. Cloudinary/Firebase) and just pass a link.
    let documentUrl = req.body.documentUrl;
    if (req.file) {
      documentUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
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
    const userId = req.user._id || req.user.id;
    const kyc = await KYC.findOne({ user: userId }).populate("document");

    let account = await Account.findOne({ user: userId });
    if (!account && req.user.kycStatus === "verified") {
      account = await createBankAccountForUser(userId);
    }

    return res.status(200).json({
      kycStatus: req.user.kycStatus,
      kycDetails: kyc || null,
      account: account || null,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch KYC status",
      error: error.message,
    });
  }
};

export const getKycQueue = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const filter = {};
    if (req.query.status) {
      filter.verificationStatus = req.query.status;
    } else {
      filter.verificationStatus = { $in: ["pending", "under_verification"] };
    }

    const [records, total] = await Promise.all([
      KYC.find(filter)
        .populate("user", "name email phone kycStatus")
        .populate("document", "documentType fileUrl uploadedAt verificationStatus")
        .populate("verifiedBy", "name")
        .sort({ createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      KYC.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: records,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("getKycQueue error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch KYC queue" });
  }
};

export const getKycDetail = async (req, res) => {
  try {
    const record = await KYC.findById(req.params.id)
      .populate("user", "name email phone address kycStatus")
      .populate("document")
      .populate("verifiedBy", "name");

    if (!record) {
      return res.status(404).json({ success: false, message: "KYC record not found" });
    }

    const otherSubmissions = await KYC.find({
      user: record.user._id,
      _id: { $ne: record._id },
    })
      .populate("document", "documentType verificationStatus")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: { record, otherSubmissions },
    });
  } catch (err) {
    console.error("getKycDetail error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch KYC record" });
  }
};

export const startKycReview = async (req, res) => {
  try {
    const record = await KYC.findById(req.params.id);

    if (!record) {
      return res.status(404).json({ success: false, message: "KYC record not found" });
    }

    if (record.verificationStatus === "verified" || record.verificationStatus === "rejected") {
      return res.status(409).json({
        success: false,
        message: `Cannot start review — record is already "${record.verificationStatus}"`,
      });
    }

    record.verificationStatus = "under_verification";
    record.verifiedBy = req.user._id || req.user.id;
    await record.save();

    await User.findByIdAndUpdate(record.user, { kycStatus: "under_verification" });

    return res.status(200).json({ success: true, data: record });
  } catch (err) {
    console.error("startKycReview error:", err);
    return res.status(500).json({ success: false, message: "Failed to start review" });
  }
};

export const approveKyc = async (req, res) => {
  try {
    const record = await KYC.findById(req.params.id);

    if (!record) {
      return res.status(404).json({ success: false, message: "KYC record not found" });
    }

    if (record.verificationStatus === "verified") {
      return res.status(409).json({ success: false, message: "Record is already verified" });
    }

    record.verificationStatus = "verified";
    record.verifiedAt = new Date();
    record.verifiedBy = req.user._id || req.user.id;
    record.rejectionReason = undefined;
    record.resubmissionRequested = false;
    await record.save();

    if (record.document) {
      await Document.findByIdAndUpdate(record.document, { verificationStatus: "verified" });
    }

    await User.findByIdAndUpdate(record.user, { kycStatus: "verified" });

    let account = null;
    let accountCreationError = null;
    try {
      account = await createBankAccountForUser(record.user);
    } catch (error) {
      accountCreationError = error.message;
      console.error(`Bank account creation failed for user ${record.user}:`, error);
    }

    await sendNotification({
      userId: record.user,
      type: "kyc",
      title: "KYC Approved",
      message: "Your KYC document has been verified and your bank account is active.",
    }).catch((err) => console.error("Notification failed:", err));

    return res.status(200).json({
      success: true,
      message: accountCreationError
        ? `KYC approved, but account creation failed: ${accountCreationError}`
        : "KYC approved successfully and bank account activated.",
      data: record,
      account,
    });
  } catch (err) {
    console.error("approveKyc error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to approve KYC" });
  }
};

export const rejectKyc = async (req, res) => {
  try {
    const { reason } = req.body;
    const requestResubmission = req.body.requestResubmission !== false;

    if (!reason || !reason.trim()) {
      return res.status(422).json({
        success: false,
        message: "A rejection reason is required",
      });
    }

    const record = await KYC.findById(req.params.id);

    if (!record) {
      return res.status(404).json({ success: false, message: "KYC record not found" });
    }

    record.verificationStatus = "rejected";
    record.verifiedAt = new Date();
    record.verifiedBy = req.user._id || req.user.id;
    record.rejectionReason = reason.trim();
    record.resubmissionRequested = requestResubmission;
    await record.save();

    if (record.document) {
      await Document.findByIdAndUpdate(record.document, { verificationStatus: "rejected" });
    }

    await User.findByIdAndUpdate(record.user, { kycStatus: "rejected" });

    await sendNotification({
      userId: record.user,
      type: "kyc",
      title: "KYC Document Rejected",
      message: requestResubmission
        ? `Your document was rejected: ${reason.trim()}. Please re-upload a valid document.`
        : `Your document was rejected: ${reason.trim()}.`,
    }).catch((err) => console.error("Notification failed:", err));

    return res.status(200).json({ success: true, data: record });
  } catch (err) {
    console.error("rejectKyc error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to reject KYC" });
  }
};
