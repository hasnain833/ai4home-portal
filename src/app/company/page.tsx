"use client";

import { useState, useEffect } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Types
interface CompanyData {
  name: string;
  logo: string;
  email: string;
  phone: string;
  address: string;
  warrantyPolicy: string;
}

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, damping: 20 },
  },
  hover: { y: -4, transition: { duration: 0.2 } },
};

const buttonVariants = {
  tap: { scale: 0.97 },
  hover: { scale: 1.02, transition: { duration: 0.2 } },
};

export default function CompanyPage() {
  const [company, setCompany] = useState<CompanyData & { id?: string }>({
    name: "",
    logo: "",
    email: "",
    phone: "",
    address: "",
    warrantyPolicy: "",
  });

  const [loading, setLoading] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    phone?: string;
  }>({});

  // Load from API on mount
  useEffect(() => {
    const fetchCompany = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/company");
        if (response.ok) {
          const data = await response.json();
          if (data) {
            setCompany({
              id: data.id,
              name: data.name || "",
              logo: data.logoUrl || "",
              email: data.email || "",
              phone: data.phone || "",
              address: data.address || "",
              warrantyPolicy: data.warrantyPolicy || "",
            });
          }
        }
      } catch (error) {
        console.error("Failed to fetch company:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchCompany();
  }, []);

  // Show toast notification
  const showToast = (type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Validate company info
  const validateCompanyInfo = (): boolean => {
    const newErrors: { name?: string; email?: string; phone?: string } = {};
    if (!company.name.trim()) newErrors.name = "Company name is required";
    if (!company.email.trim()) newErrors.email = "Email is required";
    else if (!/^\S+@\S+\.\S+$/.test(company.email))
      newErrors.email = "Invalid email format";
    if (!company.phone.trim()) newErrors.phone = "Phone number is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Save company information
  const handleSaveInfo = async () => {
    if (!validateCompanyInfo()) return;
    setSavingInfo(true);
    try {
      const response = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: company.id,
          name: company.name,
          email: company.email,
          phone: company.phone,
          address: company.address,
        }),
      });

      if (response.ok) {
        showToast("success", "Company information saved successfully");
      } else {
        showToast("error", "Failed to save information");
      }
    } catch (error) {
      showToast("error", "Error connecting to server");
    } finally {
      setSavingInfo(false);
    }
  };

  // Save warranty policy
  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    try {
      const response = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: company.id,
          warrantyPolicy: company.warrantyPolicy,
        }),
      });

      if (response.ok) {
        showToast("success", "Warranty policy saved successfully");
      } else {
        showToast("error", "Failed to save policy");
      }
    } catch (error) {
      showToast("error", "Error connecting to server");
    } finally {
      setSavingPolicy(false);
    }
  };

  // Simulate avatar upload
  const handleAvatarUpload = () => {
    // In a real app, you'd open a file picker and upload to server
    showToast("error", "Logo upload will be available in Phase 2");
  };

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <PortalLayout>
        {/* Toast Notification */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -50, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -50, x: "-50%" }}
              className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${toastMessage.type === "success"
                ? "bg-green-50 dark:bg-green-900/80 text-green-800 dark:text-green-200 border border-green-200"
                : "bg-red-50 dark:bg-red-900/80 text-red-800 dark:text-red-200 border border-red-200"
                }`}
            >
              {toastMessage.type === "success" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
              <span className="text-sm font-medium">{toastMessage.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6 p-4 sm:p-6 md:p-8 max-w-6xl mx-auto"
        >
          {/* Header */}
          <motion.div variants={fadeInUp}>
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
              Company Settings
            </h1>
            <p className="text-muted-foreground text-sm md:text-base mt-1">
              Manage your profile, contact details, and warranty policy
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Company Information Card */}
            <motion.div variants={cardVariants} whileHover="hover">
              <Card className="shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden">
                <CardHeader className="border-b border-border/50">
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />
                    Company Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5 pt-6">
                  {/* Avatar Section */}
                  <div className="flex flex-col items-center gap-3 mb-2">
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="relative group cursor-pointer"
                      onClick={handleAvatarUpload}
                    >
                      <Avatar className="h-24 w-24 ring-2 ring-primary/20 transition-all group-hover:ring-primary/40">
                        <AvatarImage src={company.logo} />
                        <AvatarFallback className="bg-linear-to-br from-primary/20 to-primary/5 text-primary text-2xl font-bold">
                          {company.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <Upload className="h-6 w-6 text-white" />
                      </div>
                    </motion.div>
                    <p className="text-xs text-muted-foreground">
                      Click to upload logo (coming soon)
                    </p>
                  </div>

                  {/* Form Fields */}
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-semibold">
                        Company Name *
                      </Label>
                      <Input
                        value={company.name}
                        onChange={(e) => {
                          setCompany({ ...company, name: e.target.value });
                          if (errors.name)
                            setErrors({ ...errors, name: undefined });
                        }}
                        className={
                          errors.name
                            ? "border-red-500 focus-visible:ring-red-500"
                            : ""
                        }
                      />
                      {errors.name && (
                        <motion.p
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-xs text-red-500 mt-1"
                        >
                          {errors.name}
                        </motion.p>
                      )}
                    </div>

                    <div>
                      <Label className="text-sm font-semibold">Email *</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="email"
                          className="pl-9"
                          value={company.email}
                          onChange={(e) => {
                            setCompany({ ...company, email: e.target.value });
                            if (errors.email)
                              setErrors({ ...errors, email: undefined });
                          }}
                        />
                      </div>
                      {errors.email && (
                        <motion.p
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-xs text-red-500 mt-1"
                        >
                          {errors.email}
                        </motion.p>
                      )}
                    </div>

                    <div>
                      <Label className="text-sm font-semibold">Phone *</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          className="pl-9"
                          value={company.phone}
                          onChange={(e) => {
                            setCompany({ ...company, phone: e.target.value });
                            if (errors.phone)
                              setErrors({ ...errors, phone: undefined });
                          }}
                        />
                      </div>
                      {errors.phone && (
                        <motion.p
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-xs text-red-500 mt-1"
                        >
                          {errors.phone}
                        </motion.p>
                      )}
                    </div>

                    <div>
                      <Label className="text-sm font-semibold">Address</Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Textarea
                          rows={2}
                          className="pl-9"
                          value={company.address}
                          onChange={(e) =>
                            setCompany({ ...company, address: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <motion.div
                    variants={buttonVariants}
                    whileTap="tap"
                    whileHover="hover"
                  >
                    <Button
                      onClick={handleSaveInfo}
                      disabled={savingInfo}
                      className="w-full gap-2"
                    >
                      {savingInfo ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {savingInfo ? "Saving..." : "Save Changes"}
                    </Button>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Warranty Policy Card */}
            <motion.div variants={cardVariants} whileHover="hover">
              <Card className="shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden">
                <CardHeader className="border-b border-border/50">
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    Warranty Policy
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5 pt-6">
                  <div>
                    <Label className="text-sm font-semibold">
                      Policy Text (used by agent)
                    </Label>
                    <Textarea
                      rows={12}
                      value={company.warrantyPolicy}
                      onChange={(e) =>
                        setCompany({
                          ...company,
                          warrantyPolicy: e.target.value,
                        })
                      }
                      className="mt-2 font-mono text-sm"
                      placeholder="Enter your warranty policy details..."
                    />
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                    <p className="font-medium mb-1">ℹ️ How this is used</p>
                    <p>
                      The AI agent will reference this warranty policy when
                      answering homeowner questions about coverage, claims, and
                      limitations.
                    </p>
                  </div>
                  <motion.div
                    variants={buttonVariants}
                    whileTap="tap"
                    whileHover="hover"
                  >
                    <Button
                      onClick={handleSavePolicy}
                      disabled={savingPolicy}
                      className="w-full gap-2"
                      variant="outline"
                    >
                      {savingPolicy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {savingPolicy ? "Saving..." : "Save Policy"}
                    </Button>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Help Card */}
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.2 }}
          >
            <Card className="border-l-4 border-l-secondary bg-linear-to-r from-secondary/5 to-transparent dark:from-secondary/10">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-secondary" />
                  Changes take effect immediately
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  All changes are saved locally and will be used by the AI agent
                  in real-time. Your warranty policy is automatically referenced
                  in conversations.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
