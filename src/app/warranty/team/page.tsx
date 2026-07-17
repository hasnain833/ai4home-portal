"use client";

import { useState, useEffect } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
  Pencil,
} from "lucide-react";
import { motion } from "framer-motion";

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  avatar?: string | null;
  // SRS §4.12: Sales permissions granted to this Builder Member.
  salesPermissions?: string[];
}

// Shape of the permission catalogue the server ships alongside the staff list, so
// the UI never keeps its own copy of the keys.
type PermissionCatalogue = Record<string, { label: string; description: string }>;

export default function TeamManagementPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [permissionCatalogue, setPermissionCatalogue] = useState<PermissionCatalogue>({});
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

  // Edit staff state variables
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    password: "",
    // SRS §4.12: which Sales features this member is authorized for.
    salesPermissions: [] as string[],
  });
  const [editFormError, setEditFormError] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);


  // Redirect if not admin or staff
  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "staff") {
      router.push("/warranty/dashboard");
    }
  }, [user, router]);

  const fetchStaff = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/admin/staff");
      if (!res.ok) throw new Error("Failed to load staff");
      const data = await res.json();
      // The endpoint used to return a bare array and now returns
      // { staff, permissionCatalogue }. Accept both so a stale cached bundle
      // against a new server (or vice versa) still renders the team list.
      if (Array.isArray(data)) {
        setStaffList(data);
      } else {
        setStaffList(data.staff || []);
        setPermissionCatalogue(data.permissionCatalogue || {});
      }
    } catch {
      setError("Could not load team members.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin" || user?.role === "staff") {
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

  const confirm = useConfirm();

  const handleDeleteStaff = async (staffId: string, staffName: string) => {
    if (!(await confirm({
      title: "Remove access?",
      description: `Are you sure you want to remove ${staffName}'s access?`,
      confirmText: "Remove access",
    }))) return;

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

  const handleStartEdit = (staff: StaffMember) => {
    setEditingStaff(staff);
    setEditForm({
      name: staff.name || "",
      email: staff.email || "",
      password: "", // empty by default
      salesPermissions: staff.salesPermissions || [],
    });
    setEditFormError("");
    setShowEditPassword(false);
    setIsEditDialogOpen(true);
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditFormError("");

    if (!editingStaff) return;
    if (!editForm.name.trim() || !editForm.email.trim()) {
      setEditFormError("Name and email are required");
      return;
    }

    if (editForm.password && editForm.password.length < 8) {
      setEditFormError("Password must be at least 8 characters");
      return;
    }

    setIsUpdating(true);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: editingStaff.id,
          name: editForm.name,
          email: editForm.email,
          password: editForm.password || undefined,
          salesPermissions: editForm.salesPermissions,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setEditFormError(data.message || "Failed to update staff member");
        return;
      }

      setSuccess(`Staff account for ${editForm.name} updated successfully!`);
      setIsEditDialogOpen(false);
      setEditingStaff(null);
      fetchStaff();
      setTimeout(() => setSuccess(""), 4000);
    } catch {
      setEditFormError("An unexpected error occurred.");
    } finally {
      setIsUpdating(false);
    }
  };


  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!user || (user.role !== "admin" && user.role !== "staff")) return null;

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
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Users className="h-8 w-8 text-[#0F3B3D] dark:text-[#b48c3c]" />
                <span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                  Team Management
                </span>
              </h1>
              <p className="text-muted-foreground mt-1">
                {user.role === "admin"
                  ? "Manage warranty staff members. Only you can create or remove staff accounts."
                  : "View warranty staff members in your company."}
              </p>
            </div>

            {user.role === "admin" && (
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
            )}
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
                  <p className="font-medium text-gray-900 dark:text-slate-100">Controlled Access Policy</p>
                  <p className="text-muted-foreground mt-0.5">
                    {user.role === "admin" ? (
                      <>
                        Staff accounts can only be created by you (the Admin). Public signup is only for administrators. Staff log in via the same{" "}
                        <span className="font-medium text-[#0F3B3D] dark:text-[#b48c3c]">/login</span> page using the credentials you provide.
                      </>
                    ) : (
                      <>
                        Staff accounts can only be created by the Company Administrator. Public signup is only for administrators. Staff log in via the same{" "}
                        <span className="font-medium text-[#0F3B3D] dark:text-[#b48c3c]">/login</span> page using the credentials provided by the Admin.
                      </>
                    )}
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
                  <p className="text-sm mt-1">
                    {user.role === "admin"
                      ? "Click \"Add Staff Member\" to create the first account."
                      : "An administrator will add staff members here."}
                  </p>
                </div>
              ) : (

                <div className="space-y-3">
                  {staffList.map((staff, index) => (
                    <motion.div
                      key={staff.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {staff.avatar ? (
                          <img
                            src={staff.avatar}
                            alt={staff.name}
                            className="h-10 w-10 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-[#0F3B3D]/10 dark:bg-[#b48c3c]/10 flex items-center justify-center shrink-0">
                            <span className="text-[#0F3B3D] dark:text-[#b48c3c] font-semibold text-sm">
                              {staff.name?.charAt(0).toUpperCase() ?? "S"}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-foreground">{staff.name}</p>
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
                        {user.role === "admin" && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStartEdit(staff)}
                              className="text-gray-500 dark:text-slate-400 hover:text-[#0F3B3D] dark:hover:text-[#b48c3c] hover:bg-gray-50 dark:hover:bg-slate-800"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteStaff(staff.id, staff.name)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>

                    </motion.div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {/* Edit Staff Dialog */}
          {user.role === "admin" && (
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Staff Member</DialogTitle>
                  <DialogDescription>
                    Update the details of the staff member. Leave the password field blank to keep the current password.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleUpdateStaff} className="space-y-4 mt-2">
                  {editFormError && (
                    <Alert variant="destructive">
                      <AlertDescription>{editFormError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="edit-staff-name">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="edit-staff-name"
                        placeholder="Sarah Johnson"
                        className="pl-9"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-staff-email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="edit-staff-email"
                        type="email"
                        placeholder="sarah@yourcompany.com"
                        className="pl-9"
                        value={editForm.email}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-staff-password">New Password (Optional)</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="edit-staff-password"
                        type={showEditPassword ? "text" : "password"}
                        placeholder="Leave blank to keep current password"
                        className="pl-9 pr-10"
                        value={editForm.password}
                        onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditPassword(!showEditPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Only enter a password if you want to reset it for them.
                    </p>
                  </div>

                  {/* SRS §4.12 / §2.2: a Builder Member operates "per permissions
                      granted by the Builder Admin". Everything not ticked here is
                      refused server-side, not merely hidden. */}
                  {Object.keys(permissionCatalogue).length > 0 && (
                    <div className="space-y-2 border-t pt-4">
                      <Label>Sales permissions</Label>
                      <p className="text-xs text-muted-foreground -mt-1">
                        What this member may do in the Sales workspace. Leads,
                        calendar and scheduling are always available.
                      </p>
                      <div className="space-y-2 pt-1">
                        {Object.entries(permissionCatalogue).map(([key, meta]) => {
                          const checked = editForm.salesPermissions.includes(key);
                          return (
                            <label
                              key={key}
                              className="flex items-start gap-2.5 cursor-pointer rounded-md p-2 -mx-2 hover:bg-muted/50"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    salesPermissions: e.target.checked
                                      ? [...f.salesPermissions, key]
                                      : f.salesPermissions.filter((p) => p !== key),
                                  }))
                                }
                                className="mt-0.5 h-4 w-4 accent-[#0F3B3D] shrink-0"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium leading-tight">
                                  {meta.label}
                                </span>
                                <span className="block text-xs text-muted-foreground mt-0.5">
                                  {meta.description}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90" disabled={isUpdating}>
                      {isUpdating ? "Saving Changes..." : "Save Changes"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </motion.div>
      </div>
    </PortalLayout>
  );
}

