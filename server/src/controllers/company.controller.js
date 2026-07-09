import prisma from "../lib/prisma.js";
import { createClient } from "@supabase/supabase-js";
import { MailService } from "../services/mail-service.js";

export const getCompany = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const company = await prisma.company.findUnique({
      where: { id: session.companyId || "demo-company" }
    });

    return res.json(company);
  } catch (error) {
    console.error("Error fetching company details:", error);
    return res.status(500).json({ message: "Error fetching company" });
  }
};

export const updateCompany = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { id, ...updateData } = req.body;
    const companyId = session.companyId || "demo-company";

    const company = await prisma.company.update({
      where: { id: companyId },
      data: updateData,
    });

    if (session.role === "ADMIN" && updateData.name) {
      await prisma.user.updateMany({
        where: { email: session.email },
        data: { name: updateData.name }
      });
    }

    return res.json(company);
  } catch (error) {
    console.error("Error updating company details:", error);
    return res.status(500).json({ message: "Error updating company" });
  }
};

export const getCompanyBranding = async (req, res) => {
  try {
    const id = req.query.id;

    if (!id) {
      return res.status(400).json({ message: "Missing company id" });
    }

    const company = await prisma.company.findUnique({
      where: { id: id },
      select: {
        name: true,
        logo: true,
        botColor: true,
      }
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    // Enable CORS so external sites can fetch this branding
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // Cache branding for 5 minutes, serve stale for 10 minutes while revalidating
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");

    return res.json(company);
  } catch (error) {
    console.error("Error fetching company branding:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Tenant onboarding: the company admin uploads a verification document (an
// image of an invoice / ID / business doc). This flips the company's
// verificationStatus to SUBMITTED so the Super Admin can review and approve it.
export const submitVerificationDocument = async (req, res) => {
  try {
    const session = req.user;

    // Only the tenant company admin can submit their verification document.
    if (!session || session.role !== "ADMIN") {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (!session.companyId) {
      return res.status(400).json({ message: "No company associated with this account" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: "No file provided" });
    }

    // Guard: only allow image uploads.
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return res.status(400).json({ message: "Only image files are allowed" });
    }

    const companyId = session.companyId;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase credentials for verification upload");
      return res.status(500).json({ message: "Server configuration error" });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Ensure bucket exists (private-ish, but we serve a public URL for the admin panel).
    const bucketName = "verification_docs";
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (!bucketsError) {
      const bucketExists = buckets.some((b) => b.name === bucketName);
      if (!bucketExists) {
        await supabase.storage.createBucket(bucketName, { public: true });
      } else {
        await supabase.storage.updateBucket(bucketName, { public: true });
      }
    }

    const fileBuffer = file.buffer;
    const originalName = file.originalname || "document.png";
    const fileName = `${companyId}/${Date.now()}_${originalName.replace(/[^a-zA-Z0-9.\-_]/g, "")}`;

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase verification upload error:", uploadError);
      return res.status(500).json({ message: "Error uploading file to storage" });
    }

    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    const url = publicUrlData.publicUrl;

    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        verificationDocUrl: url,
        verificationStatus: "SUBMITTED",
        verificationSubmittedAt: new Date(),
      },
    });

    // Best-effort: nudge the Super Admin that a document is waiting for review.
    try {
      const superAdminEmail = process.env.SUPERADMIN_EMAIL;
      if (superAdminEmail) {
        const adminUrl = `${process.env.NEXT_PUBLIC_URL || ""}/admin/verifications`;
        await MailService.sendEmail({
          to: superAdminEmail,
          subject: `Verification document submitted: ${company.name}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #b48c3c;">Verification Document Submitted</h2>
              <p><strong>${company.name}</strong> (${company.email || "no email"}) uploaded a verification document and is awaiting your approval.</p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${adminUrl}" style="background-color: #b48c3c; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Review &amp; Approve</a>
              </div>
            </div>
          `,
        });
      }
    } catch (mailErr) {
      console.error("[Verification] Failed to notify super admin of submission:", mailErr);
    }

    return res.json({
      verificationStatus: company.verificationStatus,
      verificationDocUrl: company.verificationDocUrl,
    });
  } catch (error) {
    console.error("Error submitting verification document:", error);
    return res.status(500).json({ message: "Error submitting verification document" });
  }
};

export const uploadCompanyLogo = async (req, res) => {
  try {
    const session = req.user;

    // Both ADMIN and STAFF can upload logos
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No file provided" });
    }

    const companyId = session.companyId || "demo-company";

    // 1. Initialize Supabase Admin Client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase credentials for logo upload");
      return res.status(500).json({ message: "Server configuration error" });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Ensure bucket exists
    const bucketName = "company_logos";
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (!bucketsError) {
      const bucketExists = buckets.some(b => b.name === bucketName);
      if (!bucketExists) {
        await supabase.storage.createBucket(bucketName, { public: true });
      } else {
        await supabase.storage.updateBucket(bucketName, { public: true });
      }
    }

    // 3. Upload file
    const fileBuffer = file.buffer;
    const originalName = file.originalname || "logo.png";
    const fileName = `${companyId}/${Date.now()}_${originalName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({ message: "Error uploading file to storage" });
    }

    // 4. Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    const url = publicUrlData.publicUrl;

    // 5. Save to database
    const company = await prisma.company.update({
      where: { id: companyId },
      data: { logo: url }
    });

    return res.json({ url });
  } catch (error) {
    console.error("Error uploading logo:", error);
    return res.status(500).json({ message: "Error uploading logo" });
  }
};
