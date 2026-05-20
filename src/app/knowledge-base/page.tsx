"use client";

import { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Types
interface Document {
  id: string;
  name: string;
  size: string;
  sizeBytes: number;
  uploaded: string;
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20, transition: { duration: 0.2 } },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const buttonVariants = {
  tap: { scale: 0.97 },
  hover: { scale: 1.02, transition: { duration: 0.2 } },
};

// Helper to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from API on mount
  useEffect(() => {
    const fetchDocs = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/knowledge-base");
        if (response.ok) {
          const data: any[] = await response.json();
          setDocuments(data.map(d => ({
            id: d.id,
            name: d.name,
            size: d.size,
            sizeBytes: 0,
            uploaded: new Date(d.createdAt).toLocaleDateString(),
          })));
        }
      } catch (error) {
        console.error("Failed to load documents:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchDocs();
  }, []);

  // Filter documents based on search
  const filteredDocuments = documents.filter((doc) =>
    doc.name.toLowerCase().includes(search.toLowerCase()),
  );

  // Show toast notification
  const showToast = (type: "success" | "error" | "info", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Handle file upload
  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowedTypes.includes(file.type)) {
      showToast("error", "Only PDF and DOCX files are allowed");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast("error", "File size must be less than 10MB");
      return;
    }

    setUploading(true);
    setUploadProgress(40);

    try {
      const response = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: formatFileSize(file.size),
          url: "https://example.com/mock-url.pdf",
        }),
      });

      if (response.ok) {
        const d = await response.json();
        const newDoc: Document = {
          id: d.id,
          name: d.name,
          size: d.size,
          sizeBytes: file.size,
          uploaded: new Date(d.createdAt).toLocaleDateString(),
        };

        setDocuments((prev) => [newDoc, ...prev]);
        setUploadProgress(100);
        showToast("success", `${file.name} uploaded successfully!`);
      } else {
        showToast("error", "Failed to upload document");
      }
    } catch (error) {
      showToast("error", "Error uploading to database");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Delete document
  const handleDeleteDocument = async (id: string, name: string) => {
    try {
      const response = await fetch(`/api/knowledge-base?id=${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setDocuments((prev) => prev.filter((doc) => doc.id !== id));
        showToast("info", `${name} has been deleted`);
      } else {
        showToast("error", "Failed to delete document");
      }
    } catch (error) {
      showToast("error", "Error connecting to server");
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
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
                : toastMessage.type === "error"
                  ? "bg-red-50 dark:bg-red-900/80 text-red-800 dark:text-red-200 border border-red-200"
                  : "bg-blue-50 dark:bg-blue-900/80 text-blue-800 dark:text-blue-200 border border-blue-200"
                }`}
            >
              {toastMessage.type === "success" && (
                <CheckCircle2 className="h-5 w-5" />
              )}
              {toastMessage.type === "error" && <X className="h-5 w-5" />}
              {toastMessage.type === "info" && <FileText className="h-5 w-5" />}
              <span className="text-sm font-medium">{toastMessage.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto"
        >
          {/* Header */}
          <motion.div
            variants={fadeInUp}
            className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                Knowledge Base
              </h1>
              <p className="text-muted-foreground text-sm md:text-base mt-1">
                Upload builder documents to inform the Botpress AI assistant
              </p>
            </div>
            <motion.div
              variants={buttonVariants}
              whileTap="tap"
              whileHover="hover"
            >
              <Button
                onClick={triggerFileUpload}
                disabled={uploading}
                className="shadow-md hover:shadow-lg transition-shadow"
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading... {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload PDF/DOCX
                  </>
                )}
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </motion.div>
          </motion.div>

          {/* Documents Card */}
          <motion.div variants={fadeInUp}>
            <Card className="shadow-sm hover:shadow-md transition-shadow duration-300">
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Documents
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Search Bar */}
                <div className="mb-6 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search documents by name..."
                    className="pl-9 pr-4"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                {/* Table - Responsive */}
                <div className="overflow-x-auto rounded-lg border">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="font-semibold">Name</TableHead>
                        <TableHead className="font-semibold">Size</TableHead>
                        <TableHead className="font-semibold">
                          Uploaded
                        </TableHead>
                        <TableHead className="text-right font-semibold">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <AnimatePresence mode="popLayout">
                        {filteredDocuments.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={4}
                              className="text-center py-12 text-muted-foreground"
                            >
                              <File className="h-12 w-12 mx-auto mb-3 opacity-30" />
                              No documents found
                              {search && (
                                <Button
                                  variant="link"
                                  onClick={() => setSearch("")}
                                  className="ml-2"
                                >
                                  Clear search
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredDocuments.map((doc) => (
                            <motion.tr
                              key={doc.id}
                              variants={rowVariants}
                              initial="hidden"
                              animate="visible"
                              exit="exit"
                              layout
                              className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                            >
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                  <span className="truncate max-w-[200px] md:max-w-none">
                                    {doc.name}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {doc.size}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {doc.uploaded}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <motion.div
                                    variants={buttonVariants}
                                    whileTap="tap"
                                    whileHover="hover"
                                  >
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleDeleteDocument(doc.id, doc.name)
                                      }
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 h-8 w-8 p-0"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </motion.div>
                                </div>
                              </TableCell>
                            </motion.tr>
                          ))
                        )}
                      </AnimatePresence>
                    </TableBody>
                  </Table>
                </div>

                {/* Document Count */}
                <div className="mt-4 text-xs text-muted-foreground text-right">
                  Total: {documents.length} documents
                </div>
              </CardContent>
            </Card>
          </motion.div>

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
                  <FileText className="h-5 w-5 text-secondary" />
                  Botpress Integration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Upload PDF or DOCX files up to 10MB. Once uploaded, these documents are securely registered and dynamically consumed by your Botpress AI assistant to resolve homeowner warranty queries.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
