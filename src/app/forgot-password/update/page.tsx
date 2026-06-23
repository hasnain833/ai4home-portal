"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Shield,
  Lock,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";

interface PasswordRequirement {
  id: string;
  label: string;
  test: (val: string) => boolean;
}

const requirements: PasswordRequirement[] = [
  { id: "length", label: "At least 8 characters long", test: (val) => val.length >= 8 },
  { id: "number", label: "Contains at least 1 number", test: (val) => /\d/.test(val) },
  { id: "special", label: "Contains at least 1 special character", test: (val) => /[^A-Za-z0-9]/.test(val) },
  { id: "case", label: "Contains both upper and lower case letters", test: (val) => /[A-Z]/.test(val) && /[a-z]/.test(val) },
];

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [passwordStrength, setPasswordStrength] = useState<{
    score: number;
    label: string;
    color: string;
  }>({ score: 0, label: "Very Weak", color: "bg-red-500" });

  useEffect(() => {
    const met = requirements.filter((req) => req.test(password)).length;
    let label = "Very Weak";
    let color = "bg-red-500";
    if (met === 4) {
      label = "Strong";
      color = "bg-green-500";
    } else if (met >= 2) {
      label = "Good";
      color = "bg-blue-500";
    } else if (met > 0) {
      label = "Weak";
      color = "bg-yellow-500";
    }
    setPasswordStrength({ score: met, label, color });
  }, [password]);

  useEffect(() => {
    async function checkSession() {
      try {
        let errorMsg = "";

        if (typeof window !== "undefined") {
          // 1. Check query parameters for error redirections
          const queryParams = new URLSearchParams(window.location.search);
          const queryError = queryParams.get("error_description") || queryParams.get("error");
          if (queryError) {
            errorMsg = queryError;
          }

          // 2. Check hash parameters
          if (window.location.hash) {
            const hash = window.location.hash.substring(1);
            const hashParams = new URLSearchParams(hash);

            const hashError = hashParams.get("error_description") || hashParams.get("error");
            if (hashError) {
              errorMsg = hashError;
            }

            const accessToken = hashParams.get("access_token");
            const refreshToken = hashParams.get("refresh_token");
            const type = hashParams.get("type");

            if (accessToken && refreshToken && type === "recovery") {
              const { error: sessionError } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
              });
              if (sessionError) {
                console.error("Error setting session from hash:", sessionError.message);
                errorMsg = "Session error: " + sessionError.message;
              }
            }
          }
        }

        if (!errorMsg) {
          // Wait slightly for session to propagate
          await new Promise((resolve) => setTimeout(resolve, 300));
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            errorMsg = "Auth session is missing or your recovery link has expired. Please request a new password reset link.";
          }
        }

        if (errorMsg) {
          setError(decodeURIComponent(errorMsg.replace(/\+/g, " ")));
        }
      } catch (err) {
        setError("Failed to verify authentication session.");
      } finally {
        setCheckingSession(false);
      }
    }
    checkSession();
  }, [supabase]);


  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordStrength.score < 2) {
      setError("Please choose a stronger password");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        throw new Error(error.message);
      }

      setSuccess("Your password has been securely updated! Redirecting you to login...");

      // Clear any session so they login fresh with the new password
      await supabase.auth.signOut();

      setTimeout(() => {
        router.push("/login?reset=success");
      }, 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update password. Your recovery link may have expired.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-[#0F3B3D]/10 to-[#E8B86B]/10 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3 }}
            className="inline-flex items-center justify-center p-3 bg-[#0F3B3D] rounded-2xl shadow-lg mb-4"
          >
            <Shield className="h-8 w-8 text-[#E8B86B]" />
          </motion.div>
          <h1 className="text-2xl font-bold text-gray-900">
            Aiforhomebuilder
          </h1>
          <p className="text-muted-foreground mt-1">
            Secure Account Recovery
          </p>
        </div>

        <Card className="border-0 shadow-xl overflow-hidden">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">Reset Password</CardTitle>
            <CardDescription>
              Create a secure new password for your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {success && (
              <Alert className="mb-4 border-green-500 bg-green-50 text-green-800">
                <CheckCircle className="h-4 w-4 mr-2" />
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive" className="mb-4 animate-in fade-in duration-200">
                <AlertCircle className="h-4 w-4 mr-2" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {checkingSession ? (
              <div className="flex flex-col items-center justify-center py-6 gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0F3B3D] border-t-transparent" />
                <p className="text-xs text-muted-foreground">Verifying secure recovery session...</p>
              </div>
            ) : (
              !success && !error && (
                <motion.form
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onSubmit={handleResetPassword}
                  className="space-y-4"
                >
                  {/* Password Strength Indicator */}
                  <div className="space-y-2">
                    <Label htmlFor="password">New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-9 pr-10"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {password && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Strength:</span>
                          <span className="font-semibold">{passwordStrength.label}</span>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                            style={{ width: `${(passwordStrength.score / requirements.length) * 100}%` }}
                          />
                        </div>
                        {/* Requirements List */}
                        <div className="grid grid-cols-1 gap-1 pt-1 bg-muted/20 p-2.5 rounded-lg border border-border/40">
                          {requirements.map((req) => {
                            const isMet = req.test(password);
                            return (
                              <div key={req.id} className="flex items-center gap-1.5 text-[11px]">
                                <div className={`flex items-center justify-center h-3.5 w-3.5 rounded-full shrink-0 ${isMet ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                                  {isMet ? <Check className="h-2 w-2" /> : <span className="h-1 w-1 bg-current rounded-full" />}
                                </div>
                                <span className={isMet ? "text-green-800 dark:text-green-400 font-medium" : "text-muted-foreground"}>
                                  {req.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="••••••••"
                        className="pl-9"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-[#0F3B3D] hover:bg-[#0F3B3D]/90"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Updating...
                      </div>
                    ) : (
                      "Update Password"
                    )}
                  </Button>
                </motion.form>
              )
            )}

            {(error || success) && (
              <div className="text-center pt-4">
                <Button
                  variant="link"
                  onClick={() => router.push("/login")}
                  className="text-xs text-[#0F3B3D] hover:underline"
                >
                  Back to Sign In
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
