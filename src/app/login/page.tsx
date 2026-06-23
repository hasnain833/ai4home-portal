"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Shield,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle,
  Sparkles,
  Wrench,
  Home,
  ArrowRight,
  Activity,
  UserCheck,
  Building,
  Phone
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const getPasswordStrength = (password: string) => {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z\d]/.test(password)) score++;
  const levels = ["", "Weak", "Fair", "Good", "Strong"];
  return { score, label: levels[score] || "Very Weak" };
};

function AuthContainer() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Mode: login, signup, verify, forgot
  const [mode, setMode] = useState<"login" | "signup" | "verify" | "forgot">("login");

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState("");

  const [loginEmail, setLoginEmail] = useState(() => {
    try { return localStorage.getItem("remembered_email") ?? ""; } catch { return ""; }
  });
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => {
    try { return !!localStorage.getItem("remembered_email"); } catch { return false; }
  });

  // Signup states
  // Signup states
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, label: "" });

  // Shared UX states
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const initialMode = searchParams.get("mode");
    if (initialMode === "signup") {
      setMode("signup");
    } else {
      setMode("login");
    }

    if (searchParams.get("signup") === "success") {
      setSuccess("Account created successfully! Please sign in.");
    } else if (searchParams.get("reset") === "success") {
      setSuccess("Password reset successfully! You can now sign in with your new password.");
    }
  }, [searchParams]);


  const updatePassword = (pwd: string) => {
    setSignupPassword(pwd);
    setPasswordStrength(getPasswordStrength(pwd));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!loginEmail.trim() || !/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(loginEmail)) {
      setError("Please enter a valid email address");
      return;
    }
    if (!loginPassword) {
      setError("Password is required");
      return;
    }

    if (rememberMe) {
      localStorage.setItem("remembered_email", loginEmail);
    } else {
      localStorage.removeItem("remembered_email");
    }

    const redirectPath = searchParams.get("redirect") || undefined;

    setIsLoading(true);
    try {
      await login(loginEmail, loginPassword, redirectPath);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Login failed. Please check your credentials.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!forgotEmail.trim() || !/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(forgotEmail)) {
      setError("Please enter a valid email address");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Failed to request password reset");
        return;
      }

      setSuccess("A recovery link has been dispatched to your email inbox.");
      setForgotEmail("");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!companyName.trim()) { setError("Company name is required"); return; }
    if (!/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(companyEmail)) { setError("Please enter a valid company email address"); return; }
    if (signupPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (signupPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    if (!agreeTerms) { setError("You must agree to the Terms of Service"); return; }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          companyEmail,
          password: signupPassword,
          companyPhone,
          companyAddress,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Failed to create account");
        return;
      }

      setSuccess("Account created! We've sent a verification link to your email. Please check your inbox (and spam folder) to activate your account.");

      // Optionally switch to login mode so they can login after clicking the link
      setTimeout(() => setMode("login"), 5000);

    } catch {
      setError("An unexpected error occurred during account creation.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Left Side: Clean, High-Contrast Minimalist Landing Experience */}
      <div className="hidden md:flex md:w-[48%] lg:w-[55%] relative overflow-hidden bg-[#04060a] flex-col justify-between p-8 lg:p-12 text-white border-r border-white/5">
        {/* Subtle radial-gradient glow */}
        <div className="absolute top-[30%] left-[-10%] w-[400px] h-[400px] bg-[#c59b4c]/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[20%] right-[-10%] w-[450px] h-[450px] bg-emerald-500/10 rounded-full blur-[140px] pointer-events-none" />

        {/* Branding header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/2 border border-white/10 text-[#c59b4c] shadow-md">
            <Shield className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-zinc-100 font-serif">
            Aiforhomebuilder
          </span>
        </div>

        {/* Core Deck - Clean & Minimalist */}
        <div className="relative z-10 my-auto max-w-lg space-y-10">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#c59b4c]/10 border border-[#c59b4c]/20 px-3 py-0.5 text-[10px] font-bold tracking-wider text-[#c59b4c] uppercase">
              <Sparkles className="h-3 w-3" /> Homeowner & Builder Portal
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight leading-[1.15] text-zinc-100 font-serif">
              Your home system health, <span className="text-[#c59b4c]">digitally secured.</span>
            </h2>
            <p className="text-zinc-400 text-sm leading-relaxed max-w-md">
              Aiforhomebuilder coordinates real-time diagnostics, homeowner claims, and builder maintenance workflows. Track system faults, access step-by-step DIY guidance, or trigger direct developer support instantly.
            </p>
          </div>

          {/* Key Portal Features - Spacious & Clean */}
          <div className="space-y-6 pt-2">
            {/* Feature 1 */}
            <div className="flex gap-4 items-start">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/2 border border-white/10 text-[#c59b4c] shadow-sm">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-200">Real-Time Diagnostics</h4>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Monitor utility health and identify anomalies before they escalate.
                </p>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="flex gap-4 items-start">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/2 border border-white/10 text-emerald-400 shadow-sm">
                <Wrench className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-200">Intelligent DIY Support</h4>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Access step-by-step automated guidance to resolve minor claims fast.
                </p>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="flex gap-4 items-start">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/2 border border-white/10 text-sky-400 shadow-sm">
                <UserCheck className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-200">Synchronized CRM Integration</h4>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Seamlessly push unresolved issues to Builtopia CRM for automated builder dispatch.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10 flex items-center justify-between text-xs text-zinc-500 pt-4 border-t border-white/5">
          <span>© 2026 Aiforhomebuilder Technologies Inc.</span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <Building className="h-3.5 w-3.5 text-zinc-500" /> Core Warranty System Active
          </span>
        </div>
      </div>

      {/* Right Side: Dynamic Glowing Auth Center */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 lg:p-16 bg-[#06080d] relative overflow-hidden">
        {/* Soft, beautiful ambient glowing radial blurs */}
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#c59b4c]/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-emerald-500/5 rounded-full blur-[140px] pointer-events-none" />

        <motion.div
          layout
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="w-full max-w-lg relative z-10"
        >
          {/* Mobile-only branding */}
          <div className="text-center mb-8 md:hidden">
            <div className="inline-flex items-center justify-center p-4 bg-zinc-900 border border-white/10 text-[#c59b4c] rounded-2xl shadow-xl mb-4">
              <Shield className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 font-serif">
              Aiforhomebuilder
            </h1>
            <p className="text-zinc-400 text-xs mt-1">
              Secure home systems management portal
            </p>
          </div>

          <div className="border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.85)] bg-[#0c101b]/70 backdrop-blur-3xl rounded-[32px] overflow-hidden transition-all duration-300">
            <div className="space-y-2.5 p-8 lg:p-10 pb-6 border-b border-white/10">
              <h3 className="text-3xl font-extrabold tracking-tight text-zinc-100 font-serif leading-none">
                {mode === "login" && "Welcome back"}
                {mode === "signup" && "Create Account"}
                {mode === "verify" && "Verify Your Email"}
                {mode === "forgot" && "Forgot Password"}
              </h3>
              <p className="text-[13px] text-zinc-400 leading-relaxed font-sans mt-2">
                {mode === "login" && "Enter your credentials to access your account"}
                {mode === "signup" && "Register your company profile to access the admin portal"}
                {mode === "verify" && `Enter the 6-digit validation code dispatched to ${companyEmail}`}
                {mode === "forgot" && "Enter your email address to receive a secure password reset link"}
              </p>
            </div>

            <div className="p-8 lg:p-10 pt-6 pb-6">
              {error && (
                <div className="mb-5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl p-3 text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                  {error}
                </div>
              )}
              {success && (
                <div className="mb-5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl p-3 text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-200">
                  <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                  {success}
                </div>
              )}

              {/* Dynamic form content transitions */}
              <div className="overflow-hidden">
                <AnimatePresence mode="wait">
                  {mode === "login" && (
                    <motion.form
                      key="login-form"
                      initial={{ opacity: 0, x: -15 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 15 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={handleLogin}
                      className="space-y-5"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Email Address</Label>
                        <div className="relative group">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                          <Input
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            className="pl-12 pr-4 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            disabled={isLoading}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="password" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Password</Label>
                        <div className="relative group">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className="pl-12 pr-12 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            disabled={isLoading}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="remember"
                            checked={rememberMe}
                            onCheckedChange={(checked) => setRememberMe(checked === true)}
                            className="border-white/20 data-[state=checked]:bg-[#c59b4c] data-[state=checked]:text-zinc-950 data-[state=checked]:border-[#c59b4c] bg-white/2"
                          />
                          <Label htmlFor="remember" className="text-xs font-semibold leading-none cursor-pointer text-zinc-400 hover:text-zinc-300 transition-colors">
                            Remember email
                          </Label>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setMode("forgot");
                            setError("");
                            setSuccess("");
                          }}
                          className="text-xs font-bold text-[#c59b4c] hover:text-[#d4ae62] hover:underline transition-all bg-transparent border-none p-0 cursor-pointer focus:outline-none"
                        >
                          Forgot password?
                        </button>
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 text-sm font-bold tracking-wide rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 mt-2 bg-[#c59b4c] hover:bg-[#d4ae62] text-zinc-950 hover:scale-[1.01] active:scale-[0.99] border-0 cursor-pointer flex items-center justify-center"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <span className="flex items-center gap-2 justify-center">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                            Logging in...
                          </span>
                        ) : (
                          "Sign In"
                        )}
                      </Button>
                    </motion.form>
                  )}

                  {mode === "signup" && (
                    <motion.form
                      key="signup-form"
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -15 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={handleSignup}
                      className="space-y-4"
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="companyName" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Company Name *</Label>
                        <div className="relative group">
                          <Building className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                          <Input
                            id="companyName"
                            type="text"
                            placeholder="Acme Construction"
                            className="pl-12 pr-4 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            disabled={isLoading}
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="companyEmail" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Company Email *</Label>
                          <div className="relative group">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                            <Input
                              id="companyEmail"
                              type="email"
                              placeholder="info@acme.com"
                              className="pl-12 pr-4 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                              value={companyEmail}
                              onChange={(e) => setCompanyEmail(e.target.value)}
                              disabled={isLoading}
                              required
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="companyPhone" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Company Phone</Label>
                          <div className="relative group">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                            <Input
                              id="companyPhone"
                              type="text"
                              placeholder="(555) 123-4567"
                              className="pl-12 pr-4 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                              value={companyPhone}
                              onChange={(e) => {
                                const sanitized = e.target.value.replace(/[^0-9+\-()\s]/g, "");
                                setCompanyPhone(sanitized);
                              }}
                              disabled={isLoading}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="companyAddress" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Company Address</Label>
                        <div className="relative group">
                          <Home className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                          <Input
                            id="companyAddress"
                            type="text"
                            placeholder="123 Main St, City, State"
                            className="pl-12 pr-4 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                            value={companyAddress}
                            onChange={(e) => setCompanyAddress(e.target.value)}
                            disabled={isLoading}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="signup-password" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Password *</Label>
                        <div className="relative group">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                          <Input
                            id="signup-password"
                            type={showPassword ? "text" : "password"}
                            placeholder="At least 8 characters"
                            className="pl-12 pr-12 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                            value={signupPassword}
                            onChange={(e) => updatePassword(e.target.value)}
                            disabled={isLoading}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        {signupPassword && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <div className="h-1 flex-1 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-500 ${passwordStrength.label === "Strong" ? "w-full bg-emerald-500" :
                                  passwordStrength.label === "Good" ? "w-3/4 bg-blue-500" :
                                    passwordStrength.label === "Fair" ? "w-1/2 bg-amber-500" : "w-1/4 bg-red-500"
                                  }`}
                              />
                            </div>
                            <span className="text-[10px] font-bold text-zinc-500 shrink-0">{passwordStrength.label || "Very Weak"}</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="confirm-password" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Confirm Password *</Label>
                        <div className="relative group">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                          <Input
                            id="confirm-password"
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="Confirm your password"
                            className="pl-12 pr-12 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={isLoading}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none"
                          >
                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-start space-x-2 pt-1">
                        <Checkbox
                          id="terms"
                          checked={agreeTerms}
                          onCheckedChange={(c) => setAgreeTerms(c === true)}
                          className="border-white/20 data-[state=checked]:bg-[#c59b4c] data-[state=checked]:text-zinc-950 data-[state=checked]:border-[#c59b4c] bg-white/2 mt-0.5"
                        />
                        <Label htmlFor="terms" className="text-xs text-zinc-400 cursor-pointer leading-normal">
                          I consent to the{" "}
                          <Link href="/terms" className="text-[#c59b4c] font-bold hover:underline">Terms</Link>
                          {" "}and{" "}
                          <Link href="/privacy" className="text-[#c59b4c] font-bold hover:underline">Privacy Policy</Link>
                        </Label>
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 text-sm font-bold tracking-wide rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 mt-2 bg-[#c59b4c] hover:bg-[#d4ae62] text-zinc-950 hover:scale-[1.01] active:scale-[0.99] border-0 cursor-pointer flex items-center justify-center gap-2"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <span className="flex items-center gap-2 justify-center">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                            Creating Account...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            Create Account <ArrowRight className="h-4 w-4" />
                          </span>
                        )}
                      </Button>
                    </motion.form>
                  )}

                  {mode === "forgot" && (
                    <motion.form
                      key="forgot-form"
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -15 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={handleForgotPassword}
                      className="space-y-5"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="forgot-email" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">Email Address</Label>
                        <div className="relative group">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-[#c59b4c]" />
                          <Input
                            id="forgot-email"
                            type="email"
                            placeholder="you@example.com"
                            className="pl-12 pr-4 h-12 w-full bg-white/2 border border-white/10 hover:bg-white/10 text-zinc-100 placeholder-zinc-600 rounded-xl focus:border-[#c59b4c]/60 focus:ring-1 focus:ring-[#c59b4c]/20 focus:bg-white/20 transition-all duration-200 focus:outline-none text-sm"
                            value={forgotEmail}
                            onChange={(e) => setForgotEmail(e.target.value)}
                            disabled={isLoading}
                            required
                          />
                        </div>
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 text-sm font-bold tracking-wide rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 mt-2 bg-[#c59b4c] hover:bg-[#d4ae62] text-zinc-950 hover:scale-[1.01] active:scale-[0.99] border-0 cursor-pointer flex items-center justify-center"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <span className="flex items-center gap-2 justify-center">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                            Sending link...
                          </span>
                        ) : (
                          "Send Reset Link"
                        )}
                      </Button>
                    </motion.form>
                  )}

                </AnimatePresence>
              </div>
            </div>

            <div className="flex justify-center border-t border-white/10 bg-white/2 pt-6 pb-6 rounded-b-3xl">
              <p className="text-xs text-zinc-400">
                {mode === "login" ? (
                  <>
                    New company?{" "}
                    <button
                      onClick={() => {
                        setMode("signup");
                        setError("");
                        setSuccess("");
                      }}
                      className="font-bold text-[#c59b4c] hover:text-[#d4ae62] hover:underline ml-1.5 cursor-pointer bg-transparent border-none p-0 inline-flex items-center transition-colors focus:outline-none"
                    >
                      Create account
                    </button>
                  </>
                ) : mode === "forgot" ? (
                  <button
                    onClick={() => {
                      setMode("login");
                      setError("");
                      setSuccess("");
                    }}
                    className="font-bold text-[#c59b4c] hover:text-[#d4ae62] hover:underline cursor-pointer bg-transparent border-none p-0 inline-flex items-center transition-colors focus:outline-none"
                  >
                    Back to Sign In
                  </button>
                ) : (
                  <>
                    Already registered?{" "}
                    <button
                      onClick={() => {
                        setMode("login");
                        setError("");
                        setSuccess("");
                      }}
                      className="font-bold text-[#c59b4c] hover:text-[#d4ae62] hover:underline ml-1.5 cursor-pointer bg-transparent border-none p-0 inline-flex items-center transition-colors focus:outline-none"
                    >
                      Sign In
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#f2ede4] dark:bg-zinc-950 p-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#c59b4c] border-t-transparent" />
      </div>
    }>
      <AuthContainer />
    </Suspense>
  );
}
