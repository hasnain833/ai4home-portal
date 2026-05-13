"use client";

import { useState } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2, Mail, Phone, MapPin, Save } from "lucide-react";
import { motion } from "framer-motion";

export default function CompanyPage() {
  const [company, setCompany] = useState({
    name: "Premier Homes",
    logo: "",
    email: "support@premierhomes.com",
    phone: "(555) 123-4567",
    address: "123 Builder Ave, Suite 100, Springfield",
    warrantyPolicy:
      "One-year workmanship, two-year systems, ten-year structural. All claims must be submitted within warranty period.",
  });

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <PortalLayout>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="space-y-6"
        >
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-primary dark:text-[#b48c3c] transition-colors duration-300">
              Company Settings
            </h1>
            <p className="text-muted-foreground">
              Manage your profile and warranty policy
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Company Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-center mb-4">
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={company.logo} />
                    <AvatarFallback className="bg-secondary text-primary text-2xl">
                      {company.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div>
                  <Label>Company Name</Label>
                  <Input
                    value={company.name}
                    onChange={(e) =>
                      setCompany({ ...company, name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={company.email}
                    onChange={(e) =>
                      setCompany({ ...company, email: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={company.phone}
                    onChange={(e) =>
                      setCompany({ ...company, phone: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Textarea
                    rows={2}
                    value={company.address}
                    onChange={(e) =>
                      setCompany({ ...company, address: e.target.value })
                    }
                  />
                </div>
                <Button className="w-full">
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Warranty Policy</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Label>Policy Text (used by agent)</Label>
                <Textarea
                  rows={10}
                  value={company.warrantyPolicy}
                  onChange={(e) =>
                    setCompany({ ...company, warrantyPolicy: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  The agent will reference this when answering warranty
                  questions.
                </p>
                <Button>
                  <Save className="mr-2 h-4 w-4" />
                  Save Policy
                </Button>
              </CardContent>
            </Card>
          </div>
        </motion.div>
      </PortalLayout>
    </ProtectedRoute>
  );
}
