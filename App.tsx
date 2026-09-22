import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { getNotificationsModule } from './src/utils/safeNotifications';
import { AppProvider } from './src/contexts/AppContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import AppNavigator, { navigationRef } from './src/navigation/AppNavigator';
import { NetworkBanner } from './src/components/NetworkBanner';
import { networkMonitor } from './src/utils/networkMonitor';

export default function App() {
  useEffect(() => {
    networkMonitor.start();
    return () => networkMonitor.stop();
  }, []);

  useEffect(() => {
    const Notifications = getNotificationsModule();
    if (!Notifications) return;

    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        } as any),
      });
    } catch (e) {}

    let sub: any = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
      sub = Notifications.addNotificationResponseReceivedListener(() => {
        if (navigationRef.isReady()) {
          navigationRef.navigate('Main' as any, { screen: 'Reminders' } as any);
        }
      });
    } catch (e) {}

    try {
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response?.notification?.request?.content?.data?.reminderId) {
          interval = setInterval(() => {
            if (navigationRef.isReady()) {
              navigationRef.navigate('Main' as any, { screen: 'Reminders' } as any);
              clearInterval(interval!);
              interval = null;
            }
          }, 100);
          timeout = setTimeout(() => {
            if (interval) clearInterval(interval);
            interval = null;
          }, 5000);
        }
      }).catch(() => {});
    } catch (e) {}

    return () => {
      if (sub?.remove) sub.remove();
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return (
    <ErrorBoundary>
      <AppProvider>
        <StatusBar style="auto" />
        <AppNavigator />
        <NetworkBanner />
      </AppProvider>
    </ErrorBoundary>
  );
}
