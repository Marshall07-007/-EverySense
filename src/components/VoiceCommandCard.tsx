/**
 * VoiceCommandCard.tsx
 *
 * EverySense Natural Voice & Text Assistant Component.
 * Supports natural speech input (where available) and seamless text fallback.
 * Designed with a calm, human, sophisticated royal aesthetic.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppTheme } from '../../constants/theme';
import { parseUserVoiceIntent, ParsedIntentResult } from '../services/voiceIntentService';
import { voiceManager } from '../utils/voiceCommandManager';

let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch (e) {}

interface VoiceCommandCardProps {
  theme: AppTheme;
  onExecuteIntent: (result: ParsedIntentResult) => void;
  speakText: (text: string) => void;
  isSmartScanAvailable?: boolean;
}

export type VoiceState = 'ready' | 'listening' | 'processing' | 'completed' | 'error';

export const VoiceCommandCard: React.FC<VoiceCommandCardProps> = ({
  theme,
  onExecuteIntent,
  speakText,
  isSmartScanAvailable = false,
}) => {
  const [status, setStatus] = useState<VoiceState>('ready');
  const [statusMessage, setStatusMessage] = useState<string>('Tell me what you need.');
  const [textInput, setTextInput] = useState<string>('');
  const [helpModalVisible, setHelpModalVisible] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<ParsedIntentResult | null>(null);

  const isSpeechAvailable = Platform.OS === 'web' || !!ExpoSpeechRecognitionModule;

  const handleProcessTextCommand = async (commandText: string) => {
    const trimmed = commandText.trim();
    if (!trimmed) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    setStatus('processing');
    setStatusMessage('One moment...');

    try {
      const result = await parseUserVoiceIntent(trimmed);
      setStatus('completed');
      setLastResult(result);
      setStatusMessage('Got it.');

      // Provide clear, calm human audio response and execute intent
      switch (result.intent) {
        case 'CREATE_REMINDER':
          speakText(`Got it. Opening reminder for ${result.title}.`);
          break;
        case 'SCAN':
          speakText('Opening scanner.');
          break;
        case 'EXPLAIN':
          if (isSmartScanAvailable) {
            speakText('Explaining your document.');
          } else {
            speakText("Scan a document first and I'll explain it simply.");
          }
          break;
        case 'HELP':
          speakText('Here are some things I can help you with.');
          setHelpModalVisible(true);
          break;
      }

      onExecuteIntent(result);
      setTextInput('');
    } catch (err: any) {
      console.error('[VoiceCommandCard Error]:', err);
      setStatus('error');
      setStatusMessage('I couldn’t catch that. Please try again.');
      speakText('I could not catch that. Please try again.');
    }
  };

  const handleMicTap = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    if (status === 'listening') {
      voiceManager.stopListening();
      setStatus('ready');
      setStatusMessage('Tell me what you need.');
      return;
    }

    setStatus('listening');
    setStatusMessage("I'm listening...");

    try {
      await voiceManager.startListening(
        () => {
          setStatus('ready');
          setStatusMessage('Tell me what you need.');
        },
        (transcript: string, isFinal: boolean) => {
          if (transcript) {
            setStatusMessage(`"${transcript}"`);
            if (isFinal) {
              handleProcessTextCommand(transcript);
            }
          }
        }
      );
    } catch (err) {
      setStatus('error');
      setStatusMessage('Microphone access is unavailable. You can type below.');
    }
  };

  const sampleQuickPills = [
    { label: 'Pay electricity bill tomorrow at 6 PM', query: 'Remind me to pay my electricity bill tomorrow at 6 PM' },
    { label: 'Explain this document', query: 'Explain this document simply' },
    { label: 'Scan document', query: 'Open Smart Scan' },
    { label: 'What can you do?', query: 'What can you do?' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      {/* Refined Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.kicker, { color: theme.accent }]}>WHAT DO YOU NEED?</Text>
          <Text style={[styles.headerStatusText, { color: theme.textPrimary }]}>
            {statusMessage}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.helpIconButton, { borderColor: theme.cardBorder, backgroundColor: theme.surfaceSecondary }]}
          onPress={() => setHelpModalVisible(true)}
          accessibilityLabel="Open voice command examples"
          accessibilityRole="button"
        >
          <Ionicons name="help" size={18} color={theme.accent} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {/* Confirmed Command Result Card if just parsed */}
        {status === 'completed' && lastResult && (
          <View style={[styles.resultCard, { backgroundColor: theme.surfaceSecondary, borderColor: theme.cardBorder }]}>
            <View style={styles.resultHeader}>
              <View style={[styles.resultDot, { backgroundColor: theme.accent }]} />
              <Text style={[styles.resultTitle, { color: theme.accent }]}>GOT IT</Text>
            </View>
            <Text style={[styles.resultDesc, { color: theme.textPrimary }]}>
              {lastResult.title}
            </Text>
            {lastResult.date && (
              <Text style={[styles.resultTime, { color: theme.textSecondary }]}>
                {new Date(lastResult.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </Text>
            )}
          </View>
        )}

        {/* Primary Mic Touch Target */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[
              styles.micButton,
              {
                backgroundColor: status === 'listening' ? theme.surfaceSecondary : theme.accent,
                borderColor: theme.accent,
              },
            ]}
            onPress={handleMicTap}
            disabled={status === 'processing'}
            accessibilityLabel={status === 'listening' ? 'Stop listening' : 'Start speaking'}
            accessibilityRole="button"
          >
            {status === 'processing' ? (
              <ActivityIndicator size="small" color="#0B1020" style={{ marginRight: 8 }} />
            ) : (
              <Ionicons
                name={status === 'listening' ? 'mic' : 'mic-outline'}
                size={20}
                color={status === 'listening' ? theme.accent : '#0B1020'}
                style={{ marginRight: 8 }}
              />
            )}
            <Text
              style={[
                styles.micButtonText,
                { color: status === 'listening' ? theme.accent : '#0B1020' },
              ]}
            >
              {status === 'listening'
                ? 'Stop listening'
                : status === 'processing'
                ? 'One moment...'
                : 'Speak a command'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Quiet Text Fallback */}
        <View style={styles.inputContainer}>
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: theme.surfaceSecondary,
                color: theme.textPrimary,
                borderColor: theme.cardBorder,
              },
            ]}
            placeholder="Or type here (e.g. Remind me to pay bill tomorrow at 6 PM)..."
            placeholderTextColor={theme.placeholder}
            value={textInput}
            onChangeText={setTextInput}
            onSubmitEditing={() => handleProcessTextCommand(textInput)}
            returnKeyType="send"
            accessibilityLabel="Type your request"
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              { backgroundColor: textInput.trim() ? theme.accent : theme.surfaceSecondary },
            ]}
            onPress={() => handleProcessTextCommand(textInput)}
            disabled={!textInput.trim() || status === 'processing'}
            accessibilityLabel="Submit typed command"
            accessibilityRole="button"
          >
            <Ionicons
              name="arrow-up"
              size={18}
              color={textInput.trim() ? '#0B1020' : theme.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* Suggestion Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsScroll}
        >
          {sampleQuickPills.map((pill, idx) => (
            <TouchableOpacity
              key={idx}
              style={[
                styles.samplePill,
                { backgroundColor: theme.surfaceSecondary, borderColor: theme.cardBorder },
              ]}
              onPress={() => handleProcessTextCommand(pill.query)}
              accessibilityLabel={`Suggest command: ${pill.label}`}
              accessibilityRole="button"
            >
              <Text style={[styles.samplePillText, { color: theme.textSecondary }]}>
                {pill.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Examples Modal */}
      <Modal
        visible={helpModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHelpModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.surface, borderColor: theme.cardBorder },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Things you can ask</Text>
              <TouchableOpacity
                onPress={() => setHelpModalVisible(false)}
                accessibilityLabel="Close help"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 340 }}>
              <View style={styles.helpSection}>
                <Text style={[styles.helpSectionTitle, { color: theme.accent }]}>Reminders</Text>
                <Text style={[styles.helpExample, { color: theme.textSecondary }]}>
                  "Remind me to pay my electricity bill tomorrow at 6 PM"
                </Text>
                <Text style={[styles.helpExample, { color: theme.textSecondary }]}>
                  "Remind me to take medicine in 1 hour"
                </Text>
              </View>

              <View style={styles.helpSection}>
                <Text style={[styles.helpSectionTitle, { color: theme.accent }]}>Documents</Text>
                <Text style={[styles.helpExample, { color: theme.textSecondary }]}>
                  "Scan this bill"
                </Text>
                <Text style={[styles.helpExample, { color: theme.textSecondary }]}>
                  "Explain this document simply"
                </Text>
              </View>

              <View style={styles.helpSection}>
                <Text style={[styles.helpSectionTitle, { color: theme.accent }]}>Questions</Text>
                <Text style={[styles.helpExample, { color: theme.textSecondary }]}>
                  "What can you do?"
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: theme.accent }]}
              onPress={() => setHelpModalVisible(false)}
              accessibilityRole="button"
            >
              <Text style={styles.modalCloseBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#050811',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
  },
  headerLeft: {
    flex: 1,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 4,
  },
  headerStatusText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  helpIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  resultCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  resultDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  resultTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  resultDesc: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  resultTime: {
    fontSize: 13,
    marginTop: 2,
  },
  actionRow: {
    marginTop: 4,
    marginBottom: 10,
  },
  micButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
  },
  micButtonText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  textInput: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    minHeight: 44,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillsScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  samplePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  samplePillText: {
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  helpSection: {
    marginBottom: 16,
  },
  helpSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  helpExample: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  modalCloseBtn: {
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  modalCloseBtnText: {
    color: '#0B1020',
    fontWeight: '700',
    fontSize: 14,
  },
});
