
import React, { useState } from 'react';
import { authService } from '../services/supabaseClient.ts';
import { databaseService } from '../services/databaseService.ts';
import { DriveIcon } from './icons/DriveIcon.tsx';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (isSigningUp) {
        // 1. Validation
        if (!accessCode.trim()) {
            throw new Error("Please enter your Access Code to create an account.");
        }
        
        // 2. Check Code against Database
        const isValid = await databaseService.validateInviteCode(accessCode.trim());
        if (!isValid) {
            throw new Error("Access Code is invalid or has already been used. Please contact support.");
        }

        // 3. Create Account
        const { data, error: signUpError } = await authService.signUp(email, password);
        if (signUpError) throw signUpError;
        
        // 4. Handle Email Confirmation status
        if (data.session) {
            setMessage("Account created successfully! Logging you in...");
        } else if (data.user && !data.session) {
            // This happens if "Enable Email Confirmation" is ON in Supabase
            setMessage("Account created! Please check your email to confirm your account before logging in.");
            setIsSigningUp(false); // Switch back to login view
            setAccessCode('');
        }
      } else {
        // Sign In
        const { error } = await authService.signIn(email, password);
        if (error) {
            console.error("Login Error:", error);
            if (error.message.includes("Invalid login credentials")) {
                throw new Error("Incorrect email or password. If you just signed up, please check your email for a confirmation link.");
            }
            throw error;
        }
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
      setIsSigningUp(!isSigningUp);
      setError(null);
      setMessage(null);
      setAccessCode(''); // Clear code when switching modes
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
      <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md border border-gray-700">
        <div className="flex flex-col items-center mb-6">
          <DriveIcon className="w-12 h-12 text-blue-500 mb-3" />
          <h1 className="text-2xl font-bold text-white">Drive Sync Workspace</h1>
          <p className="text-gray-400 text-sm">
            {isSigningUp ? 'Create Admin Account' : 'Sign in to manage your data'}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-md mb-4 text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}
        
        {message && (
          <div className="bg-green-500/10 border border-green-500 text-green-400 p-3 rounded-md mb-4 text-sm">
            {message}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          {/* ACCESS CODE INPUT - Only visible during Sign Up */}
          {isSigningUp && (
             <div className="animate-in fade-in slide-in-from-top-2 p-3 bg-blue-900/20 rounded-md border border-blue-500/30">
                <label className="block text-sm font-bold text-blue-400 mb-1">Access Code</label>
                <input
                  type="text"
                  required
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-blue-500/50"
                  placeholder="Enter your invite code (e.g., kkkok)"
                />
                <p className="text-xs text-gray-400 mt-2">
                    This code is required to create your account.
                </p>
             </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition-colors disabled:opacity-50 flex justify-center items-center mt-4"
          >
            {isLoading ? (
               <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : isSigningUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center pt-4 border-t border-gray-700">
          <button
            type="button"
            onClick={toggleMode}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            {isSigningUp ? 'Already have an account? Sign In' : 'Have an Access Code? Create Account'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
