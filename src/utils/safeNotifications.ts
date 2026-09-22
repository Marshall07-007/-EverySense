/**
 * safeNotifications.ts
 * Safe lazy loader for expo-notifications.
 *
 * In Expo SDK 53+, importing or requiring 'expo-notifications' in Expo Go on Android
 * automatically executes DevicePushTokenAutoRegistration.fx and calls addPushTokenListener(),
 * throwing a fatal runtime exception.
 *
 * This module checks if the app is running in Expo Go and returns `null` BEFORE
 * 'expo-notifications' is ever required or imported, completely preventing the crash.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';

let _notificationsModule: typeof import('expo-notifications') | null = null;
let _hasAttemptedLoad = false;

/**
 * Check if the application is currently running inside the Expo Go client.
 */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any).appOwnership === 'expo';

export function getNotificationsModule(): typeof import('expo-notifications') | null {
  // In Expo Go, NEVER require('expo-notifications') because module load triggers DevicePushTokenAutoRegistration
  if (isExpoGo) {
    return null;
  }

  if (!_hasAttemptedLoad) {
    _hasAttemptedLoad = true;
    try {
      _notificationsModule = require('expo-notifications');
    } catch (e) {
      console.warn('[safeNotifications] expo-notifications unavailable:', e);
      _notificationsModule = null;
    }
  }
  return _notificationsModule;
}
