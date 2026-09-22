import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import { SmartScanResult, SmartDocumentType } from '../types';
import { AppTheme } from '../../constants/theme';

interface Props {
  result: SmartScanResult;
  theme: AppTheme;
  onReset: () => void;
  onCreateReminder: (result: SmartScanResult) => void;
}

const DOC_ICONS: Record<SmartDocumentType, keyof typeof Ionicons.glyphMap> = {
  'Electricity bill': 'flash-outline',
  'Water bill': 'water-outline',
  'Invoice/receipt': 'receipt-outline',
  'College/education document': 'school-outline',
  'General document': 'document-text-outline',
};

export const SmartScanUnderstandingCard: React.FC<Props> = ({
  result,
  theme,
  onReset,
  onCreateReminder,
}) => {
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const docIcon = DOC_ICONS[result.documentType] || 'document-text-outline';
  const hasAmount = result.amount && result.amount !== 'Not detected';
  const hasDueDate = result.dueDate && result.dueDate !== 'Not detected';
  const docTitle = result.title !== 'Not detected' ? result.title : result.documentType;

  const handleSpeakExplanation = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isSpeaking) {
      ttsStopSpeaking();
      setIsSpeaking(false);
    } else {
      setIsSpeaking(true);
      const textToSpeak = `${docTitle}. ${hasAmount ? `Amount is ${result.amount}.` : ''} ${hasDueDate ? `Due on ${result.dueDate}.` : ''} ${result.explanation}`;
      ttsSpeakText(textToSpeak, {
        rate: 1.0,
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      {/* Refined Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={[styles.kicker, { color: theme.accent }]}>EVERYSENSE UNDERSTANDING</Text>
          <View style={[styles.typeBadge, { borderColor: theme.cardBorder, backgroundColor: theme.surfaceSecondary }]}>
            <Ionicons name={docIcon} size={14} color={theme.accent} style={{ marginRight: 5 }} />
            <Text style={[styles.typeBadgeText, { color: theme.textSecondary }]}>{result.documentType}</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={[styles.docTitle, { color: theme.textPrimary }]} numberOfLines={2}>
          {docTitle.toUpperCase()}
        </Text>
      </View>

      {/* Prominent Value Summary */}
      {(hasAmount || hasDueDate) && (
        <View style={[styles.metricRow, { backgroundColor: theme.surfaceSecondary, borderColor: theme.cardBorder }]}>
          {hasAmount && (
            <View style={styles.metricItem}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>AMOUNT</Text>
              <Text style={[styles.metricAmount, { color: theme.accent }]}>{result.amount}</Text>
            </View>
          )}

          {hasAmount && hasDueDate && (
            <View style={[styles.metricDivider, { backgroundColor: theme.divider }]} />
          )}

          {hasDueDate && (
            <View style={styles.metricItem}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>DUE DATE</Text>
              <Text style={[styles.metricDueDate, { color: theme.textPrimary }]}>{result.dueDate}</Text>
            </View>
          )}
        </View>
      )}

      {/* What Matters Section */}
      <View style={styles.sectionWrap}>
        <Text style={[styles.sectionTitle, { color: theme.accent }]}>WHAT MATTERS</Text>
        <Text style={[styles.explanationText, { color: theme.textPrimary }]}>
          {result.explanation}
        </Text>

        {/* Essential Info if detected */}
        {result.importantInfo && result.importantInfo !== 'Not detected' && (
          <View style={[styles.detailsBox, { borderColor: theme.cardBorder, backgroundColor: theme.surfaceSecondary }]}>
            <Text style={[styles.detailsLabel, { color: theme.textMuted }]}>DETAILS</Text>
            <Text style={[styles.detailsText, { color: theme.textSecondary }]}>{result.importantInfo}</Text>
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <View style={[styles.actionsBar, { borderTopColor: theme.cardBorder }]}>
        <TouchableOpacity
          style={[styles.primaryActionBtn, { backgroundColor: theme.accent }]}
          onPress={() => onCreateReminder(result)}
          accessibilityRole="button"
          accessibilityLabel="Set reminder for this document"
        >
          <Ionicons name="alarm-outline" size={18} color="#0B1020" style={{ marginRight: 6 }} />
          <Text style={styles.primaryActionText}>Set Reminder</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryActionBtn, { borderColor: theme.accent, backgroundColor: theme.surfaceSecondary }]}
          onPress={handleSpeakExplanation}
          accessibilityRole="button"
          accessibilityLabel={isSpeaking ? "Stop reading" : "Read aloud"}
        >
          <Ionicons
            name={isSpeaking ? "volume-mute-outline" : "volume-high-outline"}
            size={18}
            color={theme.accent}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.secondaryActionText, { color: theme.textPrimary }]}>
            {isSpeaking ? 'Stop' : 'Read Aloud'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.resetBtn, { borderColor: theme.cardBorder, backgroundColor: theme.surfaceSecondary }]}
          onPress={onReset}
          accessibilityRole="button"
          accessibilityLabel="Scan another document"
        >
          <Ionicons name="refresh-outline" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 16,
    marginBottom: 16,
    shadowColor: '#050811',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  docTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
    lineHeight: 28,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
  },
  metricItem: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  metricAmount: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  metricDueDate: {
    fontSize: 17,
    fontWeight: '600',
  },
  metricDivider: {
    width: 1,
    height: 36,
    marginHorizontal: 14,
  },
  sectionWrap: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  explanationText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  detailsBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  detailsLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  detailsText: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    minHeight: 46,
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1020',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 46,
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  resetBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
