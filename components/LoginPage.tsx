
import React, { useState } from 'react';
import { authService } from '../services/supabaseClient.ts';
import { databaseService } from '../services/databaseService.ts';
import { DriveIcon } from './icons/DriveIcon.tsx';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessCode, setAccessCode] = useState(''); // New State for Code
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
        // 1. Verify Access Code First
        if (!accessCode.trim()) {
            throw new Error("Access Code is required to create an account.");
        }
        
        const isValidCode = await databaseService.validateInviteCode(accessCode.trim());
        if (!isValidCode) {
            throw new Error("Invalid or expired Access Code.");
        }

        // 2. Create Auth User
        const { error } = await authService.signUp(email, password);
        if (error) throw error;
        setMessage("Account created successfully! You are now logged in.");
      } else {
        // Sign In (Standard)
        const { error } = await authService.signIn(email, password);
        if (error) throw error;
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
      <