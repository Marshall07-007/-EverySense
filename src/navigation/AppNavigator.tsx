import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import { useApp } from '../contexts/AppContext';
import { getThemeConfig } from '../../constants/theme';
import { RootStackParamList, MainTabParamList } from '../types';
import SOSButton from '../components/SOSButton';
import { voiceManager } from '../utils/voiceCommandManager';


export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Screen imports
import LoginScreen from '../screens/LoginScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import AccessibilitySetupScreen from '../screens/AccessibilitySetupScreen';
import HomeScreen from '../screens/HomeScreen';
import ReminderScreen from '../screens/ReminderScreen';
import ProfileScreen from '../screens/ProfileScreen';
import CheckInScreen from '../screens/CheckInScreen';
import AIAssistantScreen from '../screens/AIAssistantScreen';
import HealthDashboardScreen from '../screens/HealthDashboardScreen';
import EmergencyCardScreen from '../screens/EmergencyCardScreen';
import CameraGuideScreen from '../screens/CameraGuideScreen';
import MedicationTrackerScreen from '../screens/MedicationTrackerScreen';
import AccessibilityFeedbackScreen from '../screens/AccessibilityFeedbackScreen';

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const MainTabNavigator = () => {
  const { state } = useApp();
  const theme = useMemo(() => getThemeConfig(state.accessibilitySettings.isDarkMode), [state.accessibilitySettings.isDarkMode]);

  // Register global navigation voice commands once
  useEffect(() => {
    const navCommands = [
      { keywords: ['go home', 'open home', 'home screen'], tab: 'Home', label: 'Home' },
      { keywords: ['go to reminders', 'open reminders', 'show reminders'], tab: 'Reminders', label: 'Reminders' },
      { keywords: ['check in', 'open check in', 'daily check in'], tab: 'CheckIn', label: 'Check In' },
      { keywords: ['open assistant', 'ai assistant', 'ask ai', 'open ai'], tab: 'Assistant', label: 'AI Assistant' },
      { keywords: ['go to profile', 'open profile', 'my profile'], tab: 'Profile', label: 'Profile' },
    ];

    navCommands.forEach(({ keywords, tab, label }) => {
      voiceManager.addCommand({
        keywords,
        description: `Navigate to ${label}`,
        category: 'navigation',
        action: () => {
          navigationRef.current?.navigate('Main' as any);
          setTimeout(() => {
            navigationRef.current?.navigate(tab as any);
          }, 100);
          voiceManager.speak(`Opening ${label}`);
        },
      });
    });

    return () => {
      navCommands.forEach(({ keywords }) => voiceManager.removeCommand(keywords));
    };
  }, []);

  return (
    <View style={navStyles.container}>
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;

          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Reminders') {
            iconName = focused ? 'alarm' : 'alarm-outline';
          } else if (route.name === 'CheckIn') {
            iconName = focused ? 'heart' : 'heart-outline';
          } else if (route.name === 'Assistant') {
            iconName = focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          } else {
            iconName = 'help-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.isDark ? '#0B1020' : '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: theme.isDark ? 'rgba(214, 179, 106, 0.16)' : 'rgba(184, 141, 59, 0.20)',
          paddingBottom: 6,
          paddingTop: 6,
          height: 64,
        },
        tabBarHideOnKeyboard: false,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.3,
        },
        headerShown: false,
      })}
      screenListeners={({ route, navigation }) => ({
        tabPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          // Announce tab name when switching TO this tab (not when re-pressing the active tab)
          if (state.voiceAnnouncementsEnabled && !navigation.isFocused()) {
            ttsSpeakText(route.name);
          }
        },
      })}
    >
      <Tab.Screen 
        name="Home" 
        component={HomeScreen}
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home screen',
        }}
      />
      <Tab.Screen 
        name="Reminders" 
        component={ReminderScreen}
        options={{
          title: 'Reminders',
          tabBarAccessibilityLabel: 'Reminders screen',
        }}
      />
      <Tab.Screen
        name="CheckIn"
        component={CheckInScreen}
        options={{
          title: 'Check In',
          tabBarAccessibilityLabel: 'Daily wellness check-in screen',
        }}
      />
      <Tab.Screen
        name="Assistant"
        component={AIAssistantScreen}
        options={{
          title: 'Assistant',
          tabBarAccessibilityLabel: 'AI health assistant screen',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Profile screen',
        }}
      />
    </Tab.Navigator>
    {/* SOS button — absolutely fills the container so it always floats above all tabs */}
    <View style={navStyles.sosOverlay} pointerEvents="box-none">
      <SOSButton />
    </View>
    </View>
  );
};

const navStyles = StyleSheet.create({
  container:  { flex: 1 },
  sosOverlay: { ...StyleSheet.absoluteFill, zIndex: 9999 },
});

const AppNavigator = () => {
  const { state } = useApp();

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          gestureEnabled: false,
        }}
      >
        {!state.isLoggedIn ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ title: 'EverySense Login' }}
          />
        ) : !state.hasSeenOnboarding ? (
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ title: 'Welcome', gestureEnabled: false }}
          />
        ) : !state.hasCompletedSetup ? (
          <Stack.Screen
            name="AccessibilitySetup"
            component={AccessibilitySetupScreen}
            options={{ title: 'Accessibility Setup', gestureEnabled: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Main"
              component={MainTabNavigator}
              options={{ title: 'EverySense' }}
            />
            <Stack.Screen
              name="HealthDashboard"
              component={HealthDashboardScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="EmergencyCard"
              component={EmergencyCardScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="CameraGuide"
              component={CameraGuideScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="MedicationTracker"
              component={MedicationTrackerScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="AccessibilityFeedback"
              component={AccessibilityFeedbackScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
