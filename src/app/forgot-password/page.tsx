"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  KeyRound,
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
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [passwordStrength, setPasswordStrength] = useState<{
    score: number;
    label: string;
    color: string;
  }>({ score: 0, label: "Very Weak", color: "bg-red-500" });

  const [correctOtp, setCorrectOtp] = useState("");

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

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to send reset code");
      }
      setCorrectOtp(data.otp);
      setSuccess("Reset verification code sent to your email address.");
      setStep(2);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || otp.length !== 6) {
      setError("Please enter a valid 6-digit code");
      return;
    }
    if (otp !== correctOtp) {
      setError("Invalid verification code. Please try again.");
      return;
    }
    setError("");
    setStep(3);
  };

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
      const res = await fetch("/api/auth/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Password reset failed");
      }
      router.push("/login?reset=success");
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
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
            Ai.Lumen Warranty Care
          </h1>
          <p className="text-muted-foreground mt-1">
            Secure Account Recovery
          </p>
        </div>

        <Card className="border-0 shadow-xl overflow-hidden">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-[#0F3B3D] font-semibold mb-2">
              <span className={`px-2 py-0.5 rounded-full ${step >= 1 ? "bg-[#0F3B3D] text-white" : "bg-muted"}`}>1</span>
              <span className="h-0.5 w-6 bg-muted" />
              <span className={`px-2 py-0.5 rounded-full ${step >= 2 ? "bg-[#0F3B3D] text-white" : "bg-muted"}`}>2</span>
              <span className="h-0.5 w-6 bg-muted" />
              <span className={`px-2 py-0.5 rounded-full ${step >= 3 ? "bg-[#0F3B3D] text-white" : "bg-muted"}`}>3</span>
            </div>
            <CardTitle className="text-2xl">
              {step === 1 && "Forgot Password"}
              {step === 2 && "Enter Verification Code"}
              {step === 3 && "Reset Password"}
            </CardTitle>
            <CardDescription>
              {step === 1 && "Enter your email address to receive a verification code."}
              {step === 2 && `Enter the 6-digit code sent to ${email}`}
              {step === 3 && "Create a secure new password for your account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {success && step === 2 && (
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

            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.form
                  key="step1"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onSubmit={handleSendOtp}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        className="pl-9"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
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
                        Sending code...
                      </div>
                    ) : (
                      "Send Verification Code"
                    )}
                  </Button>
                </motion.form>
              )}

              {step === 2 && (
                <motion.form
                  key="step2"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onSubmit={handleVerifyOtp}
                  className="space-y-4"
                >
                  <div className="space-y-2 text-center">
                    <Label htmlFor="otp" className="text-left block">Verification Code</Label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="otp"
                        type="text"
                        placeholder="123456"
                        maxLength={6}
                        className="pl-9 text-center tracking-[0.7em] font-bold text-lg"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                        required
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Didn't receive the code?{" "}
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        className="text-[#0F3B3D] hover:underline font-semibold"
                        disabled={isLoading}
                      >
                        Resend Code
                      </button>
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setStep(1)}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90"
                    >
                      Verify &amp; Continue
                    </Button>
                  </div>
                </motion.form>
              )}

              {step === 3 && (
                <motion.form
                  key="step3"
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
                                  {isMet ? <Check className="h-2 w-2 stroke-3" /> : <span className="h-1 w-1 bg-current rounded-full" />}
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
                        Resetting password...
                      </div>
                    ) : (
                      "Reset Password"
                    )}
                  </Button>
                </motion.form>
              )}
            </AnimatePresence>
          </CardContent>
          <CardFooter className="flex justify-center border-t pt-6 bg-muted/5">
            <Link
              href="/login"
              className="text-sm text-[#0F3B3D] font-medium hover:underline flex items-center gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </Link>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}
