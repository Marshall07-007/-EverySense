import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Linking } from 'react-native';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const BUTTON_SIZE = 64;
const STORAGE_KEY = 'sos_button_position';
const COUNTDOWN_SECONDS = 3;

const getDefaultPosition = () => {
  const { width, height } = Dimensions.get('window');
  return { x: width - BUTTON_SIZE - 16, y: height - BUTTON_SIZE - 90 };
};

const SOSButton: React.FC = () => {
  const { state } = useApp();
  const emergencyName = state.user?.emergencyContactName;
  const emergencyPhone = state.user?.emergencyContactPhone;
  const emergencyRel = state.user?.emergencyContactRelationship;

  // Refs so PanResponder callbacks (created once) always read the latest values
  const emergencyNameRef = useRef(emergencyName);
  const emergencyPhoneRef = useRef(emergencyPhone);
  const emergencyRelRef = useRef(emergencyRel);
  useEffect(() => {
    emergencyNameRef.current = state.user?.emergencyContactName;
    emergencyPhoneRef.current = state.user?.emergencyContactPhone;
    emergencyRelRef.current = state.user?.emergencyContactRelationship;
  }, [state.user?.emergencyContactName, state.user?.emergencyContactPhone, state.user?.emergencyContactRelationship]);

  const [modalVisible, setModalVisible] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasTriggeredRef = useRef(false);

  // Position stored as Animated.ValueXY for smooth drag
  const pan = useRef(new Animated.ValueXY(getDefaultPosition())).current;
  // Keep a plain-object copy for clamping and persistence
  const posRef = useRef(getDefaultPosition());

  // Track whether the gesture is a drag or a tap
  const isDraggingRef = useRef(false);

  // Load saved position from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          const clamped = clampPosition(saved.x, saved.y);
          posRef.current = clamped;
          pan.setValue(clamped);
        } catch {}
      }
    });
  }, []);

  const clampPosition = (x: number, y: number) => {
    const { width, height } = Dimensions.get('window');
    return {
      x: Math.max(0, Math.min(x, width - BUTTON_SIZE)),
      y: Math.max(0, Math.min(y, height - BUTTON_SIZE - 70)), // leave room above tab bar
    };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (_evt, _gestureState) => {
        isDraggingRef.current = false;
        // Offset so the button doesn't jump to finger origin
        pan.setOffset({ x: posRef.current.x, y: posRef.current.y });
        pan.setValue({ x: 0, y: 0 });
      },

      onPanResponderMove: (_evt, gestureState) => {
        const dx = Math.abs(gestureState.dx);
        const dy = Math.abs(gestureState.dy);
        if (dx > 8 || dy > 8) {
          isDraggingRef.current = true;
        }
        Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        })(_evt, gestureState);
      },

      onPanResponderRelease: (_evt, gestureState) => {
        pan.flattenOffset();

        // Calculate new position from saved offset + drag delta
        const newX = posRef.current.x + gestureState.dx;
        const newY = posRef.current.y + gestureState.dy;
        const clamped = clampPosition(newX, newY);

        posRef.current = clamped;
        pan.setValue(clamped);

        // Persist
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(clamped)).catch(() => {});

        // Treat as tap if movement was tiny
        if (!isDraggingRef.current) {
          openConfirmation();
        }

        isDraggingRef.current = false;
      },
    })
  ).current;

  const openConfirmation = () => {
    if (modalVisible) return;
    hasTriggeredRef.current = false;
    setCountdown(COUNTDOWN_SECONDS);
    setModalVisible(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const speakName = emergencyNameRef.current || 'emergency services';
    ttsSpeakText(`Emergency SOS. Calling ${speakName} in ${COUNTDOWN_SECONDS} seconds.`);

    // Start countdown
    let remaining = COUNTDOWN_SECONDS;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        triggerSOS();
      }
    }, 1000);
  };

  const cancelSOS = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setModalVisible(false);
    hasTriggeredRef.current = false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    ttsStopSpeaking();
    ttsSpeakText('Emergency cancelled.');
  };

  const triggerSOS = () => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    setModalVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    // Use saved emergency contact number, fall back to 911
    const callNumber = emergencyPhoneRef.current ? emergencyPhoneRef.current.replace(/\s+/g, '') : '911';
    const speakName = emergencyNameRef.current || 'emergency services';

    ttsSpeakText(`Calling ${speakName} now.`);
    // Small delay so speech starts before the OS call sheet appears
    setTimeout(() => {
      Linking.openURL(`tel:${callNumber}`).catch(() => {
        ttsSpeakText(`Unable to place call. Please dial ${callNumber} manually.`);
      });
    }, 800);
  };

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  return (
    <>
      <Animated.View
  style={[styles.buttonContainer, { transform: pan.getTranslateTransform() }]}
  {...panResponder.panHandlers}
  accessible                                                           
  accessibilityRole="button"                                           
  accessibilityLabel="SOS emergency button"                          
  accessibilityHint="Press and hold to trigger emergency call. Drag to reposition."  
>
        <View style={styles.button}>
          <Text style={styles.buttonLabel}>SOS</Text>
        </View>
      </Animated.View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelSOS}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            {/* Red header strip */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderText}>Emergency SOS</Text>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalMessage}>
                Do you want to call{'\n'}emergency services?
              </Text>

              {emergencyName || emergencyPhone ? (
                <View style={styles.contactBanner}>
                  <Ionicons name="person-circle-outline" size={20} color="#D32F2F" />
                  <View style={styles.contactBannerText}>
                    <Text style={styles.contactBannerName}>
                      {emergencyName || 'Emergency Contact'}
                      {emergencyRel ? ` · ${emergencyRel}` : ''}
                    </Text>
                    {emergencyPhone ? (
                      <Text style={styles.contactBannerPhone}>{emergencyPhone}</Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <View style={styles.countdownCircle}>
                <Text style={styles.countdownNumber}>{countdown}</Text>
              </View>

              <Text style={styles.autoText}>
                Auto-calling in {countdown}s…
              </Text>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={cancelSOS}
                  accessibilityRole="button"                                            
                  accessibilityLabel="Cancel emergency call"
                  accessibilityHint="Dismisses the SOS dialog and stops the countdown"  
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.callButton}
                  onPress={() => {
                    if (countdownRef.current) {
                      clearInterval(countdownRef.current);
                      countdownRef.current = null;
                    }
                    triggerSOS();
                  }}
                  accessibilityRole="button"                                            
                  accessibilityLabel="Call emergency services now"
                  accessibilityHint="Immediately dials your emergency contact"          
                >
                  <Text style={styles.callButtonText}>Call Now</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  buttonContainer: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    zIndex: 9999,
    elevation: 20,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: '#D32F2F',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 10,
    borderWidth: 2,
    borderColor: '#FF8A80',
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },

  // Modal overlay
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    width: 300,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  modalHeader: {
    backgroundColor: '#D32F2F',
    paddingVertical: 16,
    alignItems: 'center',
  },
  modalHeaderText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modalBody: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
  },
  modalMessage: {
    fontSize: 16,
    color: '#212121',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 20,
  },
  countdownCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#D32F2F',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  countdownNumber: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  autoText: {
    fontSize: 13,
    color: '#757575',
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#424242',
  },
  callButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#D32F2F',
    alignItems: 'center',
  },
  callButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Emergency contact banner inside modal
  contactBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFEBEE',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    width: '100%',
  },
  contactBannerText: {
    flex: 1,
  },
  contactBannerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B71C1C',
  },
  contactBannerPhone: {
    fontSize: 12,
    color: '#C62828',
    marginTop: 2,
  },
});

export default SOSButton;
