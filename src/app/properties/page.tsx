"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  User as UserIcon,
  MapPin,
  CheckCircle2,
  X,
  Loader2,
  Sparkles,
  ChevronRight
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

// Animation variants
const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 },
  },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export default function PropertiesPage() {
  const { user } = useAuth();
  const isHomeowner = user?.role === "homeowner";

  const [properties, setProperties] = useState<Property[]>([]);
  const [homeowners, setHomeowners] = useState<HomeownerSelect[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [coeDate, setCoeDate] = useState("");
  const [homeownerId, setHomeownerId] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const fetchProperties = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/properties");
      if (res.ok) {
        const data = await res.json();
        setProperties(data);
      }
    } catch (error) {
      console.error("Error fetching properties:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchHomeowners = async () => {
    try {
      const res = await fetch("/api/users?role=homeowner");
      if (res.ok) {
        const data = await res.json();
        setHomeowners(data);
      }
    } catch (error) {
      console.error("Error fetching homeowners:", error);
    }
  };

  useEffect(() => {
    fetchProperties();
    if (!isHomeowner) {
      fetchHomeowners();
    }
  }, [isHomeowner]);

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);

    if (!address || !homeownerId) {
      setFormError("Property Address and Homeowner are required.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          city,
          state: stateVal,
          zipCode,
          coeDate: coeDate || null,
          homeownerId,
        }),
      });

      if (res.ok) {
        const newProperty = await res.json();
        setProperties([newProperty, ...properties]);
        setIsModalOpen(false);
        setAddress("");
        setCity("");
        setStateVal("");
        setZipCode("");
        setCoeDate("");
        setHomeownerId("");
        setToast("Property registered successfully!");
        setTimeout(() => setToast(null), 3000);
      } else {
        const errorData = await res.json();
        setFormError(errorData.message || "Failed to register property.");
      }
    } catch (error) {
      setFormError("Server error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const getWarrantyYear = (coeDate: string | null) => {
    if (!coeDate) return 1;
    const coe = new Date(coeDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - coe.getTime());
    const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
    if (diffYears <= 1) return 1;
    if (diffYears <= 2) return 2;
    return 10;
  };

  // Scoped property search filter
  const filteredProperties = properties.filter((p) => {
    const query = searchQuery.toLowerCase();
    return (
      p.address.toLowerCase().includes(query) ||
      (p.city && p.city.toLowerCase().includes(query)) ||
      (p.homeowner?.name && p.homeowner.name.toLowerCase().includes(query))
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
                  : "Register, assign, and manage multi-property warranty records under builder coverage."}
              </p>
            </div>
            {!isHomeowner && (
              <Button
                onClick={() => setIsModalOpen(true)}
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
            // ==========================================
            // HOMEOWNER PROPERTIES GRID
            // ==========================================
            <motion.div variants={fadeInUp} className="grid gap-6 grid-cols-1 md:grid-cols-2">
              {properties.length > 0 ? (
                properties.map((p) => {
                  const coverageYear = getWarrantyYear(p.coeDate);
                  return (
                    <motion.div key={p.id} whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                      <Card className="overflow-hidden hover:shadow-lg transition-all border-l-4 border-l-[#0F3B3D]">
                        <CardHeader className="bg-gray-50/50 pb-4">
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
                        </CardHeader>
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
                                {coverageYear === 1
                                  ? "1-Year Workmanship"
                                  : coverageYear === 2
                                    ? "2-Year Distribution Systems"
                                    : "10-Year Structural"}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-gray-500 font-medium">Have an issue with this property?</span>
                            <Link href="/chat">
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
                    Please contact your homebuilder if your property does not appear automatically under your account.
                  </p>
                </div>
              )}
            </motion.div>
          ) : (
            // ==========================================
            // ADMIN / STAFF PROPERTIES TABLE
            // ==========================================
            <motion.div variants={fadeInUp} className="space-y-4">
              {/* Search bar */}
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
                    <Table className="min-w-[800px] md:min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Property Address</TableHead>
                          <TableHead>City & Zip</TableHead>
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
                              <TableCell className="font-semibold text-gray-800 flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-[#0F3B3D] shrink-0" />
                                {p.address}
                              </TableCell>
                              <TableCell className="text-gray-500">
                                {p.city || "N/A"} {p.zipCode ? `, ${p.zipCode}` : ""}
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
                                <Link href="/tickets">
                                  <Button variant="ghost" size="sm" className="text-[#0F3B3D] hover:bg-[#0F3B3D]/10">
                                    Tickets
                                  </Button>
                                </Link>
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

          {/* Add Property Modal */}
          <AnimatePresence>
            {isModalOpen && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto animate-in fade-in duration-200">
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-white dark:bg-gray-900 rounded-3xl p-6 w-full max-w-lg shadow-2xl relative border dark:border-gray-800"
                >
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="absolute right-4 top-4 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 hover:text-gray-600 transition"
                  >
                    <X className="h-5 w-5" />
                  </button>

                  <div className="flex items-center gap-3 mb-5 border-b dark:border-gray-800 pb-4">
                    <div className="bg-[#0F3B3D] p-2.5 rounded-2xl text-white">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[#0F3B3D] dark:text-[#E8B86B]">Register Builder Property</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Add a new property to homeowner warranty coverage.</p>
                    </div>
                  </div>

                  <form onSubmit={handleCreateProperty} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="address" className="text-gray-700 dark:text-gray-200 font-semibold">Street Address</Label>
                      <Input
                        id="address"
                        placeholder="e.g. 123 Main St"
                        className="bg-white border border-gray-300 text-gray-900 focus:border-[#0F3B3D] focus:ring-[#0F3B3D] dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        required
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5 col-span-1">
                        <Label htmlFor="city" className="text-gray-700 dark:text-gray-200 font-semibold">City</Label>
                        <Input
                          id="city"
                          placeholder="Dallas"
                          className="bg-white border border-gray-300 text-gray-900 focus:border-[#0F3B3D] focus:ring-[#0F3B3D] dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5 col-span-1">
                        <Label htmlFor="state" className="text-gray-700 dark:text-gray-200 font-semibold">State</Label>
                        <Input
                          id="state"
                          placeholder="TX"
                          className="bg-white border border-gray-300 text-gray-900 focus:border-[#0F3B3D] focus:ring-[#0F3B3D] dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                          value={stateVal}
                          onChange={(e) => setStateVal(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5 col-span-1">
                        <Label htmlFor="zipCode" className="text-gray-700 dark:text-gray-200 font-semibold">Zip Code</Label>
                        <Input
                          id="zipCode"
                          placeholder="75001"
                          className="bg-white border border-gray-300 text-gray-900 focus:border-[#0F3B3D] focus:ring-[#0F3B3D] dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                          value={zipCode}
                          onChange={(e) => setZipCode(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="homeowner" className="text-gray-700 dark:text-gray-200 font-semibold">Select Homeowner</Label>
                      <Select value={homeownerId} onValueChange={setHomeownerId}>
                        <SelectTrigger id="homeowner" className="bg-white border border-gray-300 text-gray-900 focus:border-[#0F3B3D] focus:ring-[#0F3B3D] dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
                          <SelectValue placeholder="Assign Homeowner Account" className="text-gray-500" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                          {homeowners.map((ho) => (
                            <SelectItem key={ho.id} value={ho.id} className="hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                              {ho.name || "Unnamed"} ({ho.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="coeDate" className="text-gray-700 dark:text-gray-200 font-semibold">COE Date (Warranty Activation)</Label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                        <Input
                          id="coeDate"
                          type="date"
                          className="pl-9 bg-white border border-gray-300 text-gray-900 focus:border-[#0F3B3D] focus:ring-[#0F3B3D] dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                          value={coeDate}
                          onChange={(e) => setCoeDate(e.target.value)}
                        />
                      </div>
                    </div>

                    {formError && (
                      <div className="text-red-600 bg-red-50 p-3 rounded-xl text-sm font-semibold">
                        {formError}
                      </div>
                    )}

                    <div className="flex gap-3 justify-end pt-3 border-t dark:border-gray-800">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setIsModalOpen(false)}
                        className="text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={submitting}
                        className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-semibold gap-2"
                      >
                        {submitting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                          </>
                        ) : (
                          "Register Property"
                        )}
                      </Button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
