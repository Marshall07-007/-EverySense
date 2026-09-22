export interface User {
  id: string;
  email: string;
  pin: string;
  name: string;
  joinDate?: string;
  bio?: string;
  weight?: string;
  height?: string;
  bloodGroup?: string;
  allergies?: string;
  medicalConditions?: string;
  medications?: string;
  profilePhoto?: string;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
}

export interface AccessibilitySettings {
  brightness: number; // 0-100
  textZoom: number; // 100-200
  voiceSpeed: number; // 0.5-2.0
  isDarkMode: boolean;
}
export type ReminderCategory = 'medication' | 'doctor' | 'therapy' | 'exercise' | 'personal' | 'emergency';
export type ReminderPriority = 'low' | 'medium' | 'high' | 'emergency';
export type ReminderRecurrence = 'once' | 'daily' | 'weekly' | 'monthly';

export interface Reminder {
  id: string;
  title: string;
  description?: string;
  date: Date;
  time: Date;
  isCompleted: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category?: ReminderCategory;
  priority?: ReminderPriority;
  recurrence?: ReminderRecurrence;
}



export interface VoiceCommand {
  command: string;
  action: () => void;
}

export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  AccessibilitySetup: undefined;
  Main: undefined;
  HealthDashboard: undefined;
  EmergencyCard: undefined;
  CameraGuide: undefined;
  MedicationTracker: undefined;
  AccessibilityFeedback: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Reminders: { prefillDescription?: string; prefillTitle?: string; prefillDate?: string; pendingAlertReminderId?: string } | undefined;
  CheckIn: undefined;
  Assistant: { initialPrompt?: string; documentContext?: string; documentTitle?: string } | undefined;
  Profile: undefined;
};

export type SmartDocumentType =
  | 'Electricity bill'
  | 'Water bill'
  | 'Invoice/receipt'
  | 'College/education document'
  | 'General document';

export interface SmartScanResult {
  documentType: SmartDocumentType;
  title: string;
  amount: string;
  dueDate: string;
  keyDates: string;
  importantInfo: string;
  explanation: string;
  imageUri?: string;
}

export type WhatNextActionType =
  | 'CREATE_REMINDER'
  | 'EXPLAIN'
  | 'CHAT'
  | 'SAVE';

export interface WhatNextAction {
  id: string;
  type: WhatNextActionType;
  title: string;
  description: string;
  icon: string;
  isPrimary?: boolean;
  metadata?: Record<string, any>;
}

export interface WhatNextPlan {
  summary: string;
  steps: string[];
  actions: WhatNextAction[];
}

