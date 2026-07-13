"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  Trash2,
  Search,
  Loader2,
  CheckCircle2,
  X,
  File,
  Plus,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Types
interface Community {
  id: string;
  name: string;
  color: string;
}

interface Document {
  id: string;
  name: string;
  size: string;
  sizeBytes: number;
  uploaded: string;
  community?: { id: string; name: string; color: string } | null;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const isAdmin = false; // Changed to false to allow Admin full CRUD access like staff
  const [documents, setDocuments] = useState<Document[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string>("");
  const [isDragActive, setIsDragActive] = useState(false);

  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New Community Form State
  const [showCommunityForm, setShowCommunityForm] = useState(false);
  const [newCommunityName, setNewCommunityName] = useState("");

  // Delete Confirmation State
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState<string>("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [docsRes, commsRes] = await Promise.all([
        fetch("/api/knowledge-base"),
        fetch("/api/communities"),
      ]);

      if (docsRes.ok) {
        const data: any[] = await docsRes.json();
        setDocuments(
          data.map((d: any) => ({
            id: d.id,
            name: d.name,
            size: d.size,
            sizeBytes: 0,
            uploaded: new Date(d.createdAt).toLocaleDateString(),
            community: d.community,
          })),
        );
      }

      if (commsRes.ok) {
        setCommunities(await commsRes.json());
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredDocuments = documents.filter(
    (doc) =>
      doc.name.toLowerCase().includes(search.toLowerCase()) ||
      doc.community?.name.toLowerCase().includes(search.toLowerCase()),
  );

  const showToast = (type: "success" | "error" | "info", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleMultipleFilesUpload = async (files: FileList | File[]) => {
    if (isAdmin) return;
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const allowedTypes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (!allowedTypes.includes(file.type)) {
        showToast(
          "error",
          `Skipped ${file.name}: Only PDF and DOCX files are allowed`,
        );
        failCount++;
        continue;
      }

      if (file.size > 10 * 1024 * 1024) {
        showToast(
          "error",
          `Skipped ${file.name}: File size must be less than 10MB`,
        );
        failCount++;
        continue;
      }

      setUploadProgress(Math.round((i / fileArray.length) * 100));

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("communityId", selectedCommunityId);

        const response = await fetch("/api/knowledge-base", {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          const d = await response.json();
          const newDoc: Document = {
            id: d.id,
            name: d.name,
            size: d.size,
            sizeBytes: file.size,
            uploaded: new Date(d.createdAt).toLocaleDateString(),
            community: d.community,
          };

          setDocuments((prev) => [newDoc, ...prev]);
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        console.error("[warranty/knowledge-base]", error);
        failCount++;
      }
    }

    setUploading(false);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (successCount > 0 && failCount === 0) {
      showToast("success", `Uploaded ${successCount} file(s) successfully!`);
    } else if (successCount > 0 && failCount > 0) {
      showToast(
        "info",
        `Uploaded ${successCount} file(s) successfully. Failed/skipped ${failCount}.`,
      );
    } else if (failCount > 0) {
      showToast("error", `Failed to upload files.`);
    }
  };

  const handleDeleteDocument = async (id: string, name: string) => {
    if (isAdmin) return;
    try {
      const response = await fetch(`/api/knowledge-base?id=${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setDocuments((prev) => prev.filter((doc) => doc.id !== id));
        showToast("info", `${name} has been deleted`);
      }
    } catch (error) {
      console.error("[warranty/knowledge-base]", error);
      showToast("error", "Error connecting to server");
    }
  };

  const handleCreateCommunity = async () => {
    if (!newCommunityName.trim()) return;

    // Pick a random aesthetic theme color
    const colors = [
      "#0F3B3D",
      "#1E3A8A",
      "#4C1D95",
      "#064E3B",
      "#701A75",
      "#7C2D12",
      "#0F172A",
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    try {
      const res = await fetch("/api/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCommunityName, color: randomColor }),
      });
      if (res.ok) {
        const comm = await res.json();
        setCommunities([comm, ...communities]);
        setNewCommunityName("");
        setShowCommunityForm(false);
        setSelectedCommunityId(comm.id);
        showToast("success", "Community created");
      }
    } catch (error) {
      console.error("[warranty/knowledge-base]", error);
      showToast("error", "Failed to create community");
    }
  };

  const handleDeleteCommunity = async (id: string) => {
    try {
      const res = await fetch(`/api/communities?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setCommunities((prev) => prev.filter((c) => c.id !== id));
        showToast("info", "Community deleted");
        fetchData();
      }
    } catch (error) {
      console.error("[warranty/knowledge-base]", error);
      showToast("error", "Failed to delete community");
    }
  };

  // Drag and drop handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);

      if (isAdmin) return;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleMultipleFilesUpload(e.dataTransfer.files);
      }
    },
    [isAdmin, selectedCommunityId],
  ); // depend on community

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout>
        {/* Toast */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -50, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -50, x: "-50%" }}
              className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
                toastMessage.type === "success"
                  ? "bg-green-50 text-green-800"
                  : toastMessage.type === "error"
                    ? "bg-red-50 text-red-800"
                    : "bg-blue-50 text-blue-800"
              }`}>
              {toastMessage.type === "success" && (
                <CheckCircle2 className="h-5 w-5" />
              )}
              {toastMessage.type === "error" && <X className="h-5 w-5" />}
              {toastMessage.type === "info" && <FileText className="h-5 w-5" />}
              <span className="text-sm font-medium">{toastMessage.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-6 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Knowledge Base
              </h1>
              <p className="text-muted-foreground mt-1">
                {isAdmin
                  ? "View builder documents connected to the Botpress AI assistant"
                  : "Manage communities and upload KB documents"}
              </p>
            </div>
          </div>

          {!isAdmin && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Communities Management */}
              <Card className="md:col-span-1 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg">Communities</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCommunityForm(!showCommunityForm)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent>
                  <AnimatePresence>
                    {showCommunityForm && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="mb-4 space-y-2 overflow-hidden">
                        <Input
                          placeholder="Community Name"
                          value={newCommunityName}
                          onChange={(e) => setNewCommunityName(e.target.value)}
                        />
                        <Button
                          className="w-full"
                          onClick={handleCreateCommunity}>
                          Add Community
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-2 max-h-75 overflow-y-auto pr-2">
                    {communities.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-2 rounded-md border bg-card hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: c.color }}></div>
                          <span className="text-sm font-medium">{c.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-500"
                          onClick={() => handleDeleteCommunity(c.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    {communities.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        No communities created.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Upload Zone */}
              <Card className="md:col-span-2 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Upload Document</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <label className="text-sm font-medium mb-1 block">
                      Select Community
                    </label>
                    <select
                      className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={selectedCommunityId}
                      onChange={(e) => setSelectedCommunityId(e.target.value)}>
                      <option value="">
                        Shared / Common (All Communities)
                      </option>
                      {communities.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                      isDragActive
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/50"
                    }`}>
                    <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg mb-1">
                      Drag & Drop files here
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      or click to browse (PDF/DOCX max 10MB)
                    </p>

                    {uploading && (
                      <div className="flex items-center justify-center text-primary text-sm font-medium">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                        Uploading... {uploadProgress}%
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept=".pdf,.docx"
                    multiple
                    onChange={(e) => {
                      if (e.target.files)
                        handleMultipleFilesUpload(e.target.files);
                    }}
                    disabled={uploading}
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Documents Table */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-6 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by doc or community..."
                  className="pl-9 pr-4"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-160">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Name</TableHead>
                      <TableHead>Community</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Uploaded</TableHead>
                      {!isAdmin && (
                        <TableHead className="text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence>
                      {filteredDocuments.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center py-8 text-muted-foreground">
                            No documents found
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredDocuments.map((doc) => (
                          <motion.tr
                            key={doc.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b hover:bg-muted/30 transition-colors">
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="truncate max-w-50">
                                  {doc.name}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {doc.community ? (
                                <Badge
                                  variant="outline"
                                  style={{
                                    borderColor: doc.community.color,
                                    color: doc.community.color,
                                  }}>
                                  {doc.community.name}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className="bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                                  Shared / Common
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {doc.size}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {doc.uploaded}
                            </TableCell>
                            {!isAdmin && (
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setDeleteConfirmId(doc.id);
                                    setDeleteConfirmName(doc.name);
                                  }}
                                  className="text-red-600 h-8 w-8 p-0">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            )}
                          </motion.tr>
                        ))
                      )}
                    </AnimatePresence>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Delete Document Confirmation Dialog */}
        <Dialog
          open={deleteConfirmId !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteConfirmId(null);
          }}>
          <DialogContent className="sm:max-w-md bg-card border border-border shadow-xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-foreground">
                Delete Document
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-2">
                Are you sure you want to delete{" "}
                <span className="font-semibold text-foreground">
                  {deleteConfirmName}
                </span>
                ? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4 gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirmId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="bg-red-600 hover:bg-red-700 text-white font-medium"
                onClick={() => {
                  if (deleteConfirmId) {
                    handleDeleteDocument(deleteConfirmId, deleteConfirmName);
                    setDeleteConfirmId(null);
                  }
                }}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PortalLayout>
    </ProtectedRoute>
  );
}
