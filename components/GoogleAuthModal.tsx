import React, { useState } from 'react';
import { DriveIcon } from './icons/DriveIcon.tsx';
import { SystemSettings } from '../database/schema.ts';

interface GoogleAuthModalProps {
  onClose: () => void;
  initialSettings: SystemSettings;
  isConnected: boolean;
  onConnect: (creds: { apiKey: string; clientId: string; clientSecret: string }) => Promise<void>;
}

const GoogleAuthModal: React.FC<GoogleAuthModalProps> = ({
  onClose,
  initialSettings,
  isConnected,
  onConnect,
}) => {
  const [apiKey, setApiKey] = useState(initialSettings.googleApiKey);
  const [clientId, setClientId] = useState(initialSettings.googleClientId);
  const [clientSecret, setClientSecret] = useState(initialSettings.googleClientSecret);
  const [isConnecting, setIsConnecting] = useState(false);

  const currentOrigin = window.location.origin;
  const userDomain = 'https://n8nexus.site';

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await onConnect({ apiKey, clientId, clientSecret });
      // On success, the modal will be closed by the parent component
    } catch (error) {
      // Error is alerted in the parent component
    } finally {
      setIsConnecting(false);
    }
  };

  