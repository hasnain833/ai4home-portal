"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import PortalLayout from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  UserPlus,
  Trash2,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Copy,
  CheckCircle,
  Shield,
} from "lucide-react";
import { motion } from "framer-motion";

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export default function TeamManagementPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [newStaff, setNewStaff] = useState({
    name: "",
    email: "",
    password: "",
  });

  // Redirect if not admin
  useEffect(() => {
    if (user && user.role !== "admin") {
      router.push("/dashboard");
    }
  }, [user, router]);

  const fetchStaff = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/admin/staff");
      if (!res.ok) throw new Error("Failed to load staff");
      const data = await res.json();
      setStaffList(data);
    } catch {
      setError("Could not load team members.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") {
      fetchStaff();
    }
  }, [user]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!newStaff.name.trim() || !newStaff.email.trim() || !newStaff.password.trim()) {
      setFormError("All fields are required");
      return;
    }
    if (newStaff.password.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }

    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newStaff),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.message || "Failed to create staff member"); return; }

      setSuccess(`Staff account for ${newStaff.name} created successfully!`);
      setNewStaff({ name: "", email: "", password: "" });
      setIsDialogOpen(false);
      fetchStaff();
      setTimeout(() => setSuccess(""), 4000);
    } catch {
      setFormError("An unexpected error occurred.");
    }
  };

  const handleDeleteStaff = async (staffId: string, staffName: string) => {
    if (!confirm(`Are you sure you want to remove ${staffName}'s access?`)) return;

    try {
      const res = await fetch("/api/admin/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId }),
      });
      if (!res.ok) throw new Error("Failed to remove staff");
      setSuccess(`${staffName}'s account has been removed.`);
      fetchStaff();
      setTimeout(() => setSuccess(""), 4000);
    } catch {
      setError("Failed to remove staff member.");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!user || user.role !== "admin") return null;

  return (
    <PortalLayout>
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Users className="h-8 w-8 text-[#0F3B3D]" />
              Team Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage warranty staff members. Only you can create or remove staff accounts.
            </p>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 gap-2">
                <UserPlus className="h-4 w-4" />
                Add Staff Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Staff Member</DialogTitle>
                <DialogDescription>
                  Create login credentials for a new warranty staff member. Share these details with them securely.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateStaff} className="space-y-4 mt-2">
                {formError && (
                  <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="staff-name">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="staff-name"
                      placeholder="Sarah Johnson"
                      className="pl-9"
                      value={newStaff.name}
                      onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="staff-email"
                      type="email"
                      placeholder="sarah@yourcompany.com"
                      className="pl-9"
                      value={newStaff.email}
                      onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-password">Temporary Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="staff-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      className="pl-9 pr-10"
                      value={newStaff.password}
                      onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Share this password securely. The staff member should change it after first login.
                  </p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90">
                    Create Account
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Success / Error messages */}
        {success && (
          <Alert className="mb-6 border-green-500 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600 mr-2" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Security notice */}
        <Card className="mb-6 border-[#E8B86B]/40 bg-[#E8B86B]/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-[#E8B86B] mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-gray-900">Controlled Access Policy</p>
                <p className="text-muted-foreground mt-0.5">
                  Staff accounts can only be created by you (the Admin). Public signup is restricted to homeowners only. Staff log in via the same{" "}
                  <span className="font-medium text-[#0F3B3D]">/login</span> page using the credentials you provide.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Staff list */}
        <Card>
          <CardHeader>
            <CardTitle>Current Staff Members</CardTitle>
            <CardDescription>
              {staffList.length} staff member{staffList.length !== 1 ? "s" : ""} in your company
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : staffList.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No staff members yet</p>
                <p className="text-sm mt-1">Click "Add Staff Member" to create the first account.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {staffList.map((staff, index) => (
                  <motion.div
                    key={staff.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-center justify-between p-4 rounded-lg border bg-white hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-[#0F3B3D]/10 flex items-center justify-center">
                        <span className="text-[#0F3B3D] font-semibold text-sm">
                          {staff.name?.charAt(0).toUpperCase() ?? "S"}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{staff.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-sm text-muted-foreground">{staff.email}</p>
                          <button
                            onClick={() => copyToClipboard(staff.email, staff.id)}
                            className="text-muted-foreground hover:text-[#0F3B3D] transition-colors"
                          >
                            {copiedId === staff.id ? (
                              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                        Staff
                      </Badge>
                      <p className="text-xs text-muted-foreground hidden sm:block">
                        Added {new Date(staff.createdAt).toLocaleDateString()}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteStaff(staff.id, staff.name)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
    </PortalLayout>
  );
}
