"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Plus,
  Search,
  Calendar,
  ChevronRight,
  CheckCircle2,
  X,
  Loader2,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface HomeownerInfo {
  name: string | null;
  email: string;
}

interface Property {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  areaOfHome?: string | null;
  coeDate: string | null;
  homeownerId: string;
  homeowner?: HomeownerInfo;
  createdAt: string;
}

interface HomeownerSelect {
  id: string;
  name: string | null;
  email: string;
}

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

const EMPTY_FORM = {
  address: "",
  city: "",
  stateVal: "",
  zipCode: "",
  areaOfHome: "",
  coeDate: "",
  homeownerId: "",
};

export default function PropertiesPage() {
  const { user } = useAuth();
  const isHomeowner = user?.role === "homeowner";
  const canManage = user?.role === "admin" || user?.role === "staff";

  const [properties, setProperties] = useState<Property[]>([]);
  const [homeowners, setHomeowners] = useState<HomeownerSelect[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Property | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchProperties = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/properties");
      if (res.ok) setProperties(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchHomeowners = async () => {
    try {
      const res = await fetch("/api/users?role=homeowner");
      if (res.ok) setHomeowners(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchProperties();
    if (canManage) fetchHomeowners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const openAddModal = () => {
    setEditingProperty(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (p: Property) => {
    setEditingProperty(p);
    setForm({
      address: p.address,
      city: p.city || "",
      stateVal: p.state || "",
      zipCode: p.zipCode || "",
      areaOfHome: p.areaOfHome || "",
      coeDate: p.coeDate ? new Date(p.coeDate).toISOString().split("T")[0] : "",
      homeownerId: p.homeownerId,
    });
    setFormError("");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProperty(null);
    setForm(EMPTY_FORM);
    setFormError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);

    if (!form.address) {
      setFormError("Property Address is required.");
      setSubmitting(false);
      return;
    }

    if (canManage && !form.homeownerId) {
      setFormError("Please select a homeowner.");
      setSubmitting(false);
      return;
    }

    const body = {
      address: form.address,
      city: form.city || null,
      state: form.stateVal || null,
      zipCode: form.zipCode || null,
      areaOfHome: form.areaOfHome || null,
      coeDate: form.coeDate || null,
      homeownerId: form.homeownerId || undefined,
    };

    try {
      let res: Response;
      if (editingProperty) {
        res = await fetch(`/api/properties/${editingProperty.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/properties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        const saved: Property = await res.json();
        if (editingProperty) {
          setProperties((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
          showToast("Property updated successfully!");
        } else {
          setProperties((prev) => [saved, ...prev]);
          showToast("Property registered successfully!");
        }
        closeModal();
      } else {
        const err = await res.json();
        setFormError(err.message || "Failed to save property.");
      }
    } catch {
      setFormError("Server error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/properties/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setProperties((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        showToast("Property deleted.");
        setDeleteTarget(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const getWarrantyYear = (coeDate: string | null) => {
    if (!coeDate) return 1;
    const diff = (Date.now() - new Date(coeDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (diff <= 1) return 1;
    if (diff <= 2) return 2;
    return 10;
  };

  const filteredProperties = properties.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.address.toLowerCase().includes(q) ||
      (p.city && p.city.toLowerCase().includes(q)) ||
      (p.homeowner?.name && p.homeowner.name.toLowerCase().includes(q))
    );
  });

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        {/* Toast */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -50, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -50, x: "-50%" }}
              className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 bg-green-50 dark:bg-green-900/80 text-green-800 dark:text-green-200 border border-green-200"
            >
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-sm font-medium">{toast}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto"
        >
          {/* Header */}
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                {isHomeowner ? "My Covered Properties" : "Builder Properties"}
              </h1>
              <p className="text-muted-foreground mt-1">
                {isHomeowner
                  ? "Track active warranty coverages, COE milestones, and property specifications."
                  : "Manage all properties under builder warranty coverage."}
              </p>
            </div>
            {(isHomeowner || canManage) && (
              <Button
                onClick={openAddModal}
                className="bg-primary hover:bg-primary/90 text-white gap-2 font-semibold self-start sm:self-auto"
              >
                <Plus className="h-4 w-4" /> Add Property
              </Button>
            )}
          </motion.div>

          {/* Properties Grid or Table */}
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : isHomeowner ? (
            // HOMEOWNER CARD GRID
            <motion.div variants={fadeInUp} className="grid gap-6 grid-cols-1 md:grid-cols-2">
              {properties.length > 0 ? (
                properties.map((p) => {
                  const coverageYear = getWarrantyYear(p.coeDate);
                  return (
                    <motion.div key={p.id} whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                      <Card className="overflow-hidden hover:shadow-lg transition-all border-l-4 border-l-[#0F3B3D]">
                        <div className="bg-gray-50/50 px-5 pt-5 pb-4">
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex items-center gap-3">
                              <div className="bg-[#0F3B3D]/10 p-2.5 rounded-xl text-[#0F3B3D]">
                                <Building2 className="h-5 w-5" />
                              </div>
                              <div>
                                <h3 className="font-bold text-[#0F3B3D] text-lg leading-tight">{p.address}</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {p.city || ""}, {p.state || ""} {p.zipCode || ""}
                                </p>
                              </div>
                            </div>
                            <Badge className="bg-[#0F3B3D] text-white shrink-0">Year {coverageYear} Coverage</Badge>
                          </div>
                        </div>
                        <CardContent className="pt-5 space-y-4">
                          <div className="grid grid-cols-2 gap-4 text-sm border-b pb-4">
                            <div>
                              <span className="text-gray-400 block text-xs uppercase font-medium">Warranty Start (COE)</span>
                              <span className="font-semibold text-gray-700 flex items-center gap-1.5 mt-1">
                                <Calendar className="h-4 w-4 text-[#0F3B3D]" />
                                {p.coeDate ? new Date(p.coeDate).toLocaleDateString() : "N/A"}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-400 block text-xs uppercase font-medium">Warranty Term</span>
                              <span className="font-semibold text-[#b48c3c] mt-1 block">
                                {coverageYear === 1 ? "1-Year Workmanship" : coverageYear === 2 ? "2-Year Distribution" : "10-Year Structural"}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-gray-500 font-medium">Have an issue with this property?</span>
                            <Link href="/tickets">
                              <Button size="sm" variant="outline" className="text-[#0F3B3D] border-[#0F3B3D] hover:bg-[#0F3B3D] hover:text-white gap-1 text-xs">
                                Ask AI <ChevronRight className="h-3 w-3" />
                              </Button>
                            </Link>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })
              ) : (
                <div className="col-span-2 text-center py-16 bg-white border rounded-2xl">
                  <Building2 className="h-14 w-14 mx-auto opacity-30 text-[#0F3B3D] mb-3" />
                  <h3 className="font-bold text-gray-700 text-lg">No properties found</h3>
                  <p className="text-sm text-gray-400 max-w-sm mx-auto mt-1">
                    Click &quot;Add Property&quot; to register a new property under your account.
                  </p>
                </div>
              )}
            </motion.div>
          ) : (
            // ADMIN / STAFF TABLE WITH CRUD
            <motion.div variants={fadeInUp} className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search properties by address, homeowner name, or city..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <Card className="overflow-hidden">
                <CardContent className="p-0 overflow-x-auto">
                  {filteredProperties.length > 0 ? (
                    <Table className="min-w-[900px] md:min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Property Address</TableHead>
                          <TableHead>City &amp; Zip</TableHead>
                          <TableHead>Area</TableHead>
                          <TableHead>Homeowner</TableHead>
                          <TableHead>COE Date</TableHead>
                          <TableHead>Coverage Term</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProperties.map((p) => {
                          const year = getWarrantyYear(p.coeDate);
                          return (
                            <TableRow key={p.id}>
                              <TableCell className="font-semibold text-gray-800">
                                <div className="flex items-center gap-2">
                                  <Building2 className="h-4 w-4 text-[#0F3B3D] shrink-0" />
                                  {p.address}
                                </div>
                              </TableCell>
                              <TableCell className="text-gray-500">
                                {p.city || "N/A"}{p.zipCode ? `, ${p.zipCode}` : ""}
                              </TableCell>
                              <TableCell className="text-gray-500 whitespace-nowrap">
                                {p.areaOfHome || "N/A"}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-gray-700">{p.homeowner?.name || "N/A"}</span>
                                  <span className="text-xs text-gray-400">{p.homeowner?.email}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-gray-500">
                                {p.coeDate ? new Date(p.coeDate).toLocaleDateString() : "N/A"}
                              </TableCell>
                              <TableCell>
                                <Badge className="bg-[#0F3B3D]/10 text-[#0F3B3D] hover:bg-[#0F3B3D]/15 font-semibold">
                                  Year {year}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-gray-500 hover:text-[#0F3B3D] hover:bg-[#0F3B3D]/10"
                                    onClick={() => openEditModal(p)}
                                    title="Edit property"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-gray-500 hover:text-red-600 hover:bg-red-50"
                                    onClick={() => setDeleteTarget(p)}
                                    title="Delete property"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-16 text-muted-foreground">
                      <Building2 className="h-12 w-12 mx-auto mb-2 opacity-30 text-[#0F3B3D]" />
                      <p className="text-sm">No properties registered matching your filter.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Add / Edit Property Modal */}
          <AnimatePresence>
            {isModalOpen && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-white dark:bg-gray-900 rounded-3xl p-6 w-full max-w-lg shadow-2xl relative border dark:border-gray-800"
                >
                  <button
                    onClick={closeModal}
                    className="absolute right-4 top-4 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 hover:text-gray-600 transition"
                  >
                    <X className="h-5 w-5" />
                  </button>

                  <div className="flex items-center gap-3 mb-5 border-b dark:border-gray-800 pb-4">
                    <div className="bg-[#0F3B3D] p-2.5 rounded-2xl text-white">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[#0F3B3D] dark:text-[#E8B86B]">
                        {editingProperty ? "Edit Property" : "Register Property"}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {editingProperty ? "Update the property details below." : "Add a new property to warranty coverage."}
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Homeowner selector — admin/staff only */}
                    {canManage && (
                      <div className="space-y-1.5">
                        <Label className="font-semibold">Homeowner</Label>
                        <Select
                          value={form.homeownerId}
                          onValueChange={(val) => setForm((f) => ({ ...f, homeownerId: val }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select homeowner..." />
                          </SelectTrigger>
                          <SelectContent>
                            {homeowners.map((h) => (
                              <SelectItem key={h.id} value={h.id}>
                                {h.name || h.email} — {h.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="address" className="font-semibold">Street Address</Label>
                      <Input
                        id="address"
                        placeholder="e.g. 123 Main St"
                        value={form.address}
                        onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="city" className="font-semibold">City</Label>
                        <Input
                          id="city"
                          placeholder="Dallas"
                          value={form.city}
                          onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="state" className="font-semibold">State</Label>
                        <Input
                          id="state"
                          placeholder="TX"
                          value={form.stateVal}
                          onChange={(e) => setForm((f) => ({ ...f, stateVal: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="zipCode" className="font-semibold">Zip Code</Label>
                        <Input
                          id="zipCode"
                          placeholder="75001"
                          value={form.zipCode}
                          onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="areaOfHome" className="font-semibold">Area of Home</Label>
                        <Input
                          id="areaOfHome"
                          placeholder="e.g. 2,500 sq ft"
                          value={form.areaOfHome}
                          onChange={(e) => setForm((f) => ({ ...f, areaOfHome: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="coeDate" className="font-semibold">COE Date (Warranty Activation)</Label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                        <Input
                          id="coeDate"
                          type="date"
                          className="pl-9"
                          value={form.coeDate}
                          onChange={(e) => setForm((f) => ({ ...f, coeDate: e.target.value }))}
                        />
                      </div>
                    </div>

                    {formError && (
                      <div className="text-red-600 bg-red-50 p-3 rounded-xl text-sm font-semibold">
                        {formError}
                      </div>
                    )}

                    <div className="flex gap-3 justify-end pt-3 border-t dark:border-gray-800">
                      <Button type="button" variant="ghost" onClick={closeModal} className="text-gray-600">
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={submitting}
                        className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-semibold gap-2"
                      >
                        {submitting ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                        ) : editingProperty ? "Update Property" : "Register Property"}
                      </Button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Delete Confirmation Modal */}
          <AnimatePresence>
            {deleteTarget && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl border dark:border-gray-800"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-red-100 p-2.5 rounded-xl text-red-600">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-gray-100">Delete Property</h3>
                      <p className="text-xs text-gray-500">This action cannot be undone.</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
                    Are you sure you want to delete <span className="font-semibold">{deleteTarget.address}</span>?
                  </p>
                  <div className="flex gap-3 justify-end">
                    <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="gap-2"
                    >
                      {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting...</> : "Delete Property"}
                    </Button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
