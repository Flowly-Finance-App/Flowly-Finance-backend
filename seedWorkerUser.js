import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import connectDB from "./config/db.js";
import User from "./models/User.js";

async function seedWorker() {
  await connectDB();
  console.log("Seeding Staff/Worker Account...");

  const passwordHash = await bcrypt.hash("Worker@1234", 10);

  const workers = [
    {
      name: "Arjun Nair",
      email: "staff@flowly.com",
      phone: "9876599990",
      password: passwordHash,
      role: "worker",
      status: "active",
      kycStatus: "verified",
      isEmailVerified: true,
    },
    {
      name: "Admin Staff",
      email: "admin@flowly.com",
      phone: "9876599991",
      password: passwordHash,
      role: "admin",
      status: "active",
      kycStatus: "verified",
      isEmailVerified: true,
    },
  ];

  for (const w of workers) {
    let user = await User.findOne({ $or: [{ email: w.email }, { phone: w.phone }] });
    if (!user) {
      user = await User.create(w);
      console.log(`Created ${w.role} user: ${w.email} (Password: Worker@1234)`);
    } else {
      user.role = w.role;
      user.status = "active";
      user.password = passwordHash;
      user.phone = w.phone;
      await user.save();
      console.log(`Updated ${w.role} user: ${w.email} (Password: Worker@1234)`);
    }
  }

  console.log("Worker seeding completed successfully!");
  await mongoose.connection.close();
  process.exit(0);
}

seedWorker().catch((err) => {
  console.error("Worker seed failed:", err);
  process.exit(1);
});
