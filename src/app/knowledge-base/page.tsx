"use client";

import { useState } from "react";
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
import { Upload, FileText, Trash2, Search } from "lucide-react";
import { motion } from "framer-motion";

const mockDocs = [
  {
    id: "1",
    name: "HVAC Troubleshooting Guide.pdf",
    size: "2.4 MB",
    uploaded: "2026-05-10",
    indexed: true,
  },
  {
    id: "2",
    name: "Plumbing Warranty Standards.pdf",
    size: "1.1 MB",
    uploaded: "2026-05-09",
    indexed: true,
  },
  {
    id: "3",
    name: "Cabinet Adjustment Manual.pdf",
    size: "0.8 MB",
    uploaded: "2026-05-08",
    indexed: false,
  },
];

export default function KnowledgeBasePage() {
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  const filtered = mockDocs.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <ProtectedRoute allowedRoles={["admin", "staff"]}>
      <PortalLayout>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="space-y-6"
        >
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-primary dark:text-[#b48c3c] transition-colors duration-300">
                Knowledge Base
              </h1>
              <p className="text-muted-foreground">
                Upload documents to inform the agent
              </p>
            </div>
            <Button disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" />
              Upload PDF/DOCX
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search documents..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="overflow-x-auto">
                <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.name}</TableCell>
                      <TableCell>{d.size}</TableCell>
                      <TableCell>{d.uploaded}</TableCell>
                      <TableCell>
                        {d.indexed ? (
                          <Badge className="bg-green-100 text-green-800">
                            Indexed
                          </Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
