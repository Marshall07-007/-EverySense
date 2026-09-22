import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { supabase } from '../../lib/supabase';
import { AccessibilitySettings, Reminder, User } from '../types';
import { voiceManager } from '../utils/voiceCommandManager';

interface AppState {
  user: User | null;
  isLoggedIn: boolean;
  hasSeenOnboarding: boolean;
  hasCompletedSetup: boolean;
  accessibilitySettings: AccessibilitySettings;
  isVoiceEnabled: boolean;
  voiceAnnouncementsEnabled: boolean;
  reminders: Reminder[];
}

type AppAction =
  | { type: 'LOGIN'; payload: User }
  | { type: 'UPDATE_USER'; payload: Partial<User> }
  | { type: 'LOGOUT' }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'COMPLETE_SETUP' }
  | { type: 'UPDATE_ACCESSIBILITY_SETTINGS'; payload: Partial<AccessibilitySettings> }
  | { type: 'TOGGLE_VOICE'; payload: boolean }
  | { type: 'TOGGLE_VOICE_ANNOUNCEMENTS'; payload: boolean }
  | { type: 'ADD_REMINDER'; payload: Reminder }
  | { type: 'UPDATE_REMINDER'; payload: Reminder }
  | { type: 'DELETE_REMINDER'; payload: string }
  | { type: 'TOGGLE_REMINDER'; payload: string }
  | { type: 'LOAD_DATA'; payload: Partial<AppState> }
  | { type: 'SET_REMINDERS'; payload: Reminder[] };

const initialState: AppState = {
  user: null,
  isLoggedIn: false,
  hasSeenOnboarding: false,
  hasCompletedSetup: false,
  accessibilitySettings: {
    brightness: 50,
    textZoom: 100,
    voiceSpeed: 1.0,
    isDarkMode: true,
  },
  isVoiceEnabled: false,
  voiceAnnouncementsEnabled: true,
  reminders: [],
};

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'LOGIN':
      return {
        ...state,
        user: action.payload,
        isLoggedIn: true,
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: state.user ? { ...state.user, ...action.payload } : state.user,
      };
    case 'LOGOUT':
      return {
        ...initialState,
      };
    case 'COMPLETE_ONBOARDING':
      return {
        ...state,
        hasSeenOnboarding: true,
      };
    case 'COMPLETE_SETUP':
      return {
        ...state,
        hasCompletedSetup: true,
      };
    case 'UPDATE_ACCESSIBILITY_SETTINGS':
      return {
        ...state,
        accessibilitySettings: {
          ...state.accessibilitySettings,
          ...action.payload,
        },
      };
    case 'TOGGLE_VOICE':
      return {
        ...state,
        isVoiceEnabled: action.payload,
      };
    case 'TOGGLE_VOICE_ANNOUNCEMENTS':
      return {
        ...state,
        voiceAnnouncementsEnabled: action.payload,
      };
    case 'ADD_REMINDER':
      return {
        ...state,
        reminders: [...state.reminders, action.payload],
      };
    case 'UPDATE_REMINDER':
      return {
        ...state,
        reminders: state.reminders.map(reminder =>
          reminder.id === action.payload.id ? action.payload : reminder
        ),
      };
    case 'DELETE_REMINDER':
      return {
        ...state,
        reminders: state.reminders.filter(reminder => reminder.id !== action.payload),
      };
    case 'TOGGLE_REMINDER':
      return {
        ...state,
        reminders: state.reminders.map(reminder =>
          reminder.id === action.payload
            ? { ...reminder, isCompleted: !reminder.isCompleted }
            : reminder
        ),
      };
    case 'LOAD_DATA':
      return {
        ...state,
        ...action.payload,
      };
    case 'SET_REMINDERS':
      return {
        ...state,
        reminders: action.payload,
      };
    default:
      return state;
  }
};

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Load data from AsyncStorage on app start (user, settings, setup flag)
  useEffect(() => {
    const loadData = async () => {
      try {
        const userData = await AsyncStorage.getItem('user');
        const settingsData = await AsyncStorage.getItem('accessibilitySettings');
        const setupData = await AsyncStorage.getItem('hasCompletedSetup');
        const onboardingData = await AsyncStorage.getItem('hasSeenOnboarding');

        if (userData) {
          const parsedUser = JSON.parse(userData);
          const userWithJoinDate = parsedUser.joinDate ? parsedUser : { ...parsedUser, joinDate: new Date().toISOString() };
          dispatch({ type: 'LOGIN', payload: userWithJoinDate });

          if (!parsedUser.joinDate) {
            await AsyncStorage.setItem('user', JSON.stringify(userWithJoinDate));
          }

          // Fetch latest profile fields from Supabase so avatar_url, name and bio
          // are restored after a reinstall (AsyncStorage would be empty then)
          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('avatar_url, name, bio, weight, height, blood_group, allergies, medical_conditions, medications, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone')
              .eq('id', userWithJoinDate.id)
              .single();
            if (profile) {
              const updates: Partial<User> = {};
              if (profile.avatar_url) updates.profilePhoto = profile.avatar_url;
              if (profile.name) updates.name = profile.name;
              if (profile.bio) updates.bio = profile.bio;
              if (profile.weight) updates.weight = profile.weight;
              if (profile.height) updates.height = profile.height;
              if (profile.blood_group) updates.bloodGroup = profile.blood_group;
              if (profile.allergies) updates.allergies = profile.allergies;
              if (profile.medical_conditions) updates.medicalConditions = profile.medical_conditions;
              if (profile.medications) updates.medications = profile.medications;
              if (profile.emergency_contact_name) updates.emergencyContactName = profile.emergency_contact_name;
              if (profile.emergency_contact_relationship) updates.emergencyContactRelationship = profile.emergency_contact_relationship;
              if (profile.emergency_contact_phone) updates.emergencyContactPhone = profile.emergency_contact_phone;
              if (Object.keys(updates).length > 0) {
                dispatch({ type: 'UPDATE_USER', payload: updates });
              }
            }
          } catch {
            // Supabase unreachable — keep AsyncStorage values
          }
        }
        if (settingsData) {
          dispatch({ type: 'UPDATE_ACCESSIBILITY_SETTINGS', payload: JSON.parse(settingsData) });
        }
        if (setupData) {
          dispatch({ type: 'LOAD_DATA', payload: { hasCompletedSetup: JSON.parse(setupData) } });
        }
        if (onboardingData) {
          dispatch({ type: 'LOAD_DATA', payload: { hasSeenOnboarding: JSON.parse(onboardingData) } });
        }
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };

    loadData();
  }, []);

  // Fetch profile (avatar, name, bio) from Supabase whenever the user logs in.
  // Runs on every user ID change so the photo is always restored even when
  // LoginScreen creates the appUser object without a profilePhoto field.
  useEffect(() => {
    if (!state.user?.id) return;
    const fetchProfile = async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('avatar_url, name, bio, weight, height, blood_group, allergies, medical_conditions, medications, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone')
          .eq('id', state.user!.id)
          .single();
        if (profile) {
          const updates: Partial<User> = {};
          if (profile.avatar_url) updates.profilePhoto = profile.avatar_url;
          if (profile.name) updates.name = profile.name;
          if (profile.bio) updates.bio = profile.bio;
          if (profile.weight) updates.weight = profile.weight;
          if (profile.height) updates.height = profile.height;
          if (profile.blood_group) updates.bloodGroup = profile.blood_group;
          if (profile.allergies) updates.allergies = profile.allergies;
          if (profile.medical_conditions) updates.medicalConditions = profile.medical_conditions;
          if (profile.medications) updates.medications = profile.medications;
          if (profile.emergency_contact_name) updates.emergencyContactName = profile.emergency_contact_name;
          if (profile.emergency_contact_relationship) updates.emergencyContactRelationship = profile.emergency_contact_relationship;
          if (profile.emergency_contact_phone) updates.emergencyContactPhone = profile.emergency_contact_phone;
          if (Object.keys(updates).length > 0) {
            dispatch({ type: 'UPDATE_USER', payload: updates });
          }
        }
      } catch {
        // Supabase unreachable — keep existing values
      }
    };
    fetchProfile();
  }, [state.user?.id]);

  // Fetch reminders from Supabase when the user ID changes (login / logout).
  // Using state.user?.id as the dependency avoids re-running on every profile field update.
  useEffect(() => {
    const loadUserReminders = async () => {
      if (!state.user?.id) {
        dispatch({ type: 'SET_REMINDERS', payload: [] });
        return;
      }

      try {
        const { data, error } = await supabase
          .from('reminders')
          .select('*')
          .eq('user_id', state.user.id)
          .order('reminder_datetime', { ascending: true });

        if (error) throw error;

        dispatch({
          type: 'SET_REMINDERS',
          payload: (data || []).map((r: any) => ({
            id: r.id,
            title: r.title,
            description: r.description,
            date: new Date(r.reminder_datetime),
            time: new Date(r.reminder_datetime),
            isCompleted: r.is_completed,
            isActive: !r.is_completed,
            createdAt: r.created_at ? new Date(r.created_at) : new Date(),
            updatedAt: r.updated_at ? new Date(r.updated_at) : new Date(),
            category: 'personal',
            priority: r.priority?.toLowerCase() || 'medium',
            recurrence: r.frequency?.toLowerCase() || 'once',
          })),
        });
      } catch {
        // Supabase unreachable — fall back to local AsyncStorage cache
        try {
          const key = `reminders_${state.user?.id}`;
          const stored = await AsyncStorage.getItem(key);
          if (stored) {
            const parsed = JSON.parse(stored).map((r: any) => ({
              ...r,
              date: new Date(r.date),
              time: new Date(r.time),
              createdAt: new Date(r.createdAt),
              updatedAt: new Date(r.updatedAt),
            }));
            dispatch({ type: 'SET_REMINDERS', payload: parsed });
          } else {
            dispatch({ type: 'SET_REMINDERS', payload: [] });
          }
        } catch (fallbackError) {
          console.error('Error loading reminders from fallback cache:', fallbackError);
          dispatch({ type: 'SET_REMINDERS', payload: [] });
        }
      }
    };

    loadUserReminders();
  }, [state.user?.id]);

  // Save data to AsyncStorage when state changes
  useEffect(() => {
    const saveData = async () => {
      try {
        if (state.user) {
          await AsyncStorage.setItem('user', JSON.stringify(state.user));
          // Also keep a directory of users up to date (by id)
          try {
            const usersRaw = await AsyncStorage.getItem('users');
            const users: any[] = usersRaw ? JSON.parse(usersRaw) : [];
            const idx = users.findIndex(u => u.id === state.user!.id);
            if (idx >= 0) {
              users[idx] = { ...users[idx], ...state.user };
            } else {
              users.unshift(state.user);
            }
            await AsyncStorage.setItem('users', JSON.stringify(users));
          } catch {}
        }
        await AsyncStorage.setItem('accessibilitySettings', JSON.stringify(state.accessibilitySettings));
        await AsyncStorage.setItem('hasCompletedSetup', JSON.stringify(state.hasCompletedSetup));
        await AsyncStorage.setItem('hasSeenOnboarding', JSON.stringify(state.hasSeenOnboarding));
        if (state.user) {
          const key = `reminders_${state.user.id}`;
          await AsyncStorage.setItem(key, JSON.stringify(state.reminders));
        }
      } catch (error) {
        console.error('Error saving data:', error);
      }
    };

    saveData();
  }, [state.user, state.accessibilitySettings, state.hasCompletedSetup, state.hasSeenOnboarding, state.reminders]);

  // Sync voice announcements setting with voiceManager
  useEffect(() => {
    // Add null check to prevent crash if voiceManager is not initialized
    if (voiceManager && typeof voiceManager.setVoiceAnnouncementsEnabled === 'function') {
      voiceManager.setVoiceAnnouncementsEnabled(state.voiceAnnouncementsEnabled);
    }
  }, [state.voiceAnnouncementsEnabled]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
