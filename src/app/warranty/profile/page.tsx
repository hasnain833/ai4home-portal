"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Camera, Circle, Pencil, X, Check, CheckCircle2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ProfilePage() {
  const { user, updateProfile, updateAvatar } = useAuth();
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedEmail, setEditedEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const getInitials = (name: string) =>
    name ? name.split(" ").map((n) => n[0]).join("").toUpperCase() : "U";

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => updateAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (user) {
      setEditedName(user.name || "");
      setEditedEmail(user.email || "");
    }
  }, [user]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  return (
    <ProtectedRoute allowedRoles={["staff", "homeowner"]}>
      <PortalLayout>
        {/* Toast Notification */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -50, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -50, x: "-50%" }}
              className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 border ${toastMessage.type === "success"
                  ? "bg-green-50 dark:bg-green-900/80 text-green-800 dark:text-green-200 border-green-200"
                  : "bg-red-50 dark:bg-red-900/80 text-red-800 dark:text-red-200 border-red-200"
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

        <div className="mx-auto max-w-3xl space-y-6">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between"
          >
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-linear-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
                Profile Settings
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage your personal information and preferences
              </p>
            </div>
            {!isEditingProfile ? (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setIsEditingProfile(true)}
              >
                <Pencil className="h-4 w-4" />
                Edit Profile
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="gap-2"
                  disabled={isSaving}
                  onClick={() => {
                    setIsEditingProfile(false);
                    setEditedName(user?.name || "");
                    setEditedEmail(user?.email || "");
                  }}
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  className="gap-2"
                  disabled={isSaving}
                  onClick={async () => {
                    if (!editedEmail.trim()) {
                      setToastMessage({ type: "error", text: "Email address cannot be empty." });
                      return;
                    }
                    setIsSaving(true);
                    try {
                      await updateProfile({ name: editedName, email: editedEmail });
                      setToastMessage({ type: "success", text: "Profile updated successfully!" });
                      setIsEditingProfile(false);
                    } catch (err: any) {
                      setToastMessage({ type: "error", text: err.message || "Failed to update profile." });
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                >
                  {isSaving ? (
                    <span className="animate-spin mr-1 h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Save Changes
                </Button>
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
                <CardDescription>Update your photo and personal details.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b">
                  <div className="relative">
                    <Avatar className="h-24 w-24 border-2 border-border shadow-xs">
                      <AvatarImage src={user?.avatar} />
                      <AvatarFallback className="text-3xl bg-secondary text-primary">
                        {user ? getInitials(user.name) : "U"}
                      </AvatarFallback>
                    </Avatar>
                    <label htmlFor="avatar-upload" className="absolute bottom-0 right-0 cursor-pointer rounded-full bg-primary p-1.5 text-white shadow-md hover:bg-primary/90 transition">
                      <Camera className="h-4 w-4" />
                      <input id="avatar-upload" type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                    </label>
                  </div>
                  <div className="text-center sm:text-left">
                    <div className="text-xl font-semibold">{user?.name}</div>
                    <div className="text-muted-foreground text-sm">{user?.email}</div>
                    <Badge variant="outline" className={`mt-2 ${user?.online ? "border-green-500 text-green-700 dark:text-green-400" : "border-gray-300"}`}>
                      <Circle className={`mr-1.5 h-2 w-2 ${user?.online ? "fill-green-500" : "fill-gray-400"}`} />
                      {user?.online ? "Online" : "Offline"}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    {isEditingProfile ? (
                      <Input
                        id="fullName"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <Input id="fullName" value={user?.name || ""} disabled className="bg-muted" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center gap-1.5">
                      Email Address
                    </Label>
                    {isEditingProfile ? (
                      <Input
                        id="email"
                        type="email"
                        value={editedEmail}
                        onChange={(e) => setEditedEmail(e.target.value)}
                      />
                    ) : (
                      <Input id="email" value={user?.email || ""} disabled className="bg-muted" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Input
                      id="role"
                      value={user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : ""}
                      disabled
                      className="bg-muted"
                    />
                  </div>

                  {user?.companyName && (
                    <div className="space-y-2">
                      <Label htmlFor="company">Company</Label>
                      <Input
                        id="company"
                        value={user.companyName}
                        disabled
                        className="bg-muted"
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
