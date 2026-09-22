import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getNotificationsModule } from './safeNotifications';

const NOTIF_IDS_KEY = 'notification_ids_v1';

export type NotifReminder = {
  id: string;
  title: string;
  description?: string;
  datetime: Date;
  isCompleted: boolean;
  recurrence?: 'once' | 'daily' | 'weekly' | 'monthly';
};

type NotifIdMap = { [reminderId: string]: string[] };

const loadMap = async (): Promise<NotifIdMap> => {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_IDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveMap = async (map: NotifIdMap): Promise<void> => {
  try {
    await AsyncStorage.setItem(NOTIF_IDS_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('notificationService: Failed to save notification ID map:', e);
  }
};

/** Cancel all scheduled notifications for a specific reminder and remove its stored IDs. */
export const cancelForReminder = async (reminderId: string): Promise<void> => {
  if (Platform.OS === 'web') return;
  const Notifications = getNotificationsModule();
  if (!Notifications) return;

  const map = await loadMap();
  const ids = map[reminderId] || [];
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch (e) {
      console.warn(`notificationService: Failed to cancel notification ${id}:`, e);
    }
  }
  delete map[reminderId];
  await saveMap(map);
};

/**
 * Schedule notification(s) for a reminder, cancelling any existing ones first.
 * Stores the returned notification IDs so they can be cancelled later.
 */
export const scheduleForReminder = async (rem: NotifReminder): Promise<void> => {
  if (Platform.OS === 'web') return;
  const Notifications = getNotificationsModule();
  if (!Notifications) return;

   // Guard: check notification permission before scheduling
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
  } catch (e) {
    return;
  }

  // Cancel any existing notifications for this reminder first
  await cancelForReminder(rem.id);

  // Don't schedule if completed or time has already passed
  if (rem.isCompleted) return;
  if (rem.datetime.getTime() <= Date.now()) return;

  const collectedIds: string[] = [];

  // Schedule the initial occurrence
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '⏰ Reminder',
        body: rem.title + (rem.description ? `. ${rem.description}` : ''),
        sound: true,
        data: { reminderId: rem.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: rem.datetime,
      },
    });
    collectedIds.push(id);
  } catch (e) {
    console.warn('Failed to schedule notification:', e);
  }

  // Schedule next 5 occurrences for recurring reminders
  if (rem.recurrence && rem.recurrence !== 'once') {
    for (let i = 1; i <= 5; i++) {
      const nextDate = new Date(rem.datetime);
      if (rem.recurrence === 'daily') {
        nextDate.setDate(nextDate.getDate() + i);
      } else if (rem.recurrence === 'weekly') {
        nextDate.setDate(nextDate.getDate() + i * 7);
      } else if (rem.recurrence === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + i);
      }

      if (nextDate.getTime() > Date.now()) {
        try {
          const id = await Notifications.scheduleNotificationAsync({
            content: {
              title: '⏰ Recurring Reminder',
              body: rem.title,
              sound: true,
              data: { reminderId: rem.id },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: nextDate,
            },
          });
          collectedIds.push(id);
        } catch (e) {
          console.warn('notificationService: Failed to schedule recurring notification:', e);
        }
      }
    }
  }

  // Persist the notification IDs for future cancellation
  if (collectedIds.length > 0) {
    const map = await loadMap();
    map[rem.id] = collectedIds;
    await saveMap(map);
  }
};

/**
 * Cancel ALL scheduled notifications and re-schedule from scratch.
 * Call this on app launch to recover after a device restart clears OS-scheduled notifications.
 */
export const rescheduleAll = async (reminders: NotifReminder[]): Promise<void> => {
  if (Platform.OS === 'web') return;
  const Notifications = getNotificationsModule();
  if (!Notifications) return;

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.warn('notificationService: Failed to cancel all notifications:', e);
  }

  // Clear the stored ID map
  await saveMap({});

  // Re-schedule each active, future reminder
  for (const rem of reminders) {
    if (!rem.isCompleted && rem.datetime.getTime() > Date.now()) {
      await scheduleForReminder(rem);
    }
  }
};
